import { describe, expect, it, beforeAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import {
  equipment,
  auditLogs,
  customerTier,
  equipmentAssignments,
  notifications,
  getBillingSettings,
  quotationItems,
  quotations,
  rentals,
  timekeeperSiteAssignments,
  withTenantTx,
} from '@arkilaunch/db';
import { StubPaymentsAdapter, bookingDays, minBookingHours, round2HalfUp, type RequestContext } from '@arkilaunch/shared';
import { BillingService } from '../src/billing/billing.service.js';
import { SitesService } from '../src/sites/sites.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';
import { checkoutPaidWebhook } from './paymongo-webhook.js';
import { fixtureCompanyId } from './fixture-company.js';
import { SIGNED } from './signed.js';

describe('Delivery, return and staff alerts', () => {
  const events = new EventsService();
  const quotes = new QuotesService(new PricingEngineService(), events);
  const bookings = new BookingsService(events, quotes, new PaymentsService(new StubPaymentsAdapter(), new EventsService()));
  // The stub's session id is deterministic, so a checkout retry would collide on the unique provider_ref.
  let sessions = 0;
  const adapter = new StubPaymentsAdapter();
  adapter.createCheckoutSession = async (amountPhp: number, invoiceId: string) => ({
    id: `stub_${invoiceId}_${++sessions}`,
    checkoutUrl: `about:blank?amount=${amountPhp}`,
  });
  const payments = new PaymentsService(adapter, events);
  const webhookSecret = 'whsec_test_secret';

  let customerCtx: RequestContext;
  let adminCtx: RequestContext;
  let siteId: string;
  let equipmentId: string;
  let rateCardId: string;
  let equipmentTypeId: string;
  let timekeeperId: string;

  let fixtureCustomerId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });

    const [tenantA] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenantA as { id: string }).id;
    const [customerUser] = await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [adminUser] = await sql`select id from users where tenant_id = ${tenantId} and id <> ${(customerUser as { id: string }).id} limit 1`;
    const [timekeeper] = await sql`select id from users where tenant_id = ${tenantId} and email = 'timekeeper@test-tenant-a.test'`;
    timekeeperId = (timekeeper as { id: string }).id;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} and customer_id is null order by created_at limit 1`;
    const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    const [rateCard] = await sql`select id, equipment_type_id from rate_cards where tenant_id = ${tenantId} and equipment_id is null and rate_type = 'hourly' and (effective_to is null or effective_to > now()) order by effective_from limit 1`;

    customerCtx = { tenantId, userId: (customerUser as { id: string }).id, role: 'customer' };

    fixtureCustomerId = await fixtureCompanyId(sql, tenantId);
    adminCtx = { tenantId, userId: (adminUser as { id: string }).id, role: 'admin' };
    siteId = (site as { id: string }).id;
    equipmentId = (unit as { id: string }).id;
    rateCardId = (rateCard as { id: string }).id;
    equipmentTypeId = (rateCard as { equipment_type_id: string }).equipment_type_id;

    // Idempotency: clear this spec's own 2032-03 bookings from a prior run,
    // children first.
    const stale = await sql`
      select distinct rental_id from equipment_assignments
      where equipment_id = ${equipmentId} and start >= '2032-07-01' and start < '2032-08-01'
    `;
    const ids = stale.map((row) => (row as { rental_id: string }).rental_id);
    if (ids.length > 0) {
      await sql`delete from negotiation_messages where rental_id = any(${ids})`;
      await sql`delete from booking_change_requests where rental_id = any(${ids})`;
      await sql`delete from invoice_line_items where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from invoices where rental_id = any(${ids})`;
      await sql`delete from rental_contracts where quotation_id in (select id from quotations where rental_id = any(${ids}))`;
      await sql`delete from quotation_items where quotation_id in (select id from quotations where rental_id = any(${ids}))`;
      await sql`update quotations set parent_quotation_id = null where rental_id = any(${ids})`;
      await sql`delete from quotations where rental_id = any(${ids})`;
      await sql`delete from equipment_assignments where rental_id = any(${ids})`;
      await sql`delete from rentals where id = any(${ids})`;
    }
    await sql.end();
  });

  function day(offset: number, hour: number) {
    return new Date(Date.UTC(2032, 6, 1 + offset, hour, 0, 0)).toISOString();
  }

  async function book(offset: number, days = 1) {
    const created = await bookings.create(customerCtx, {
      customerId: fixtureCustomerId,
      projectSiteId: siteId,
      siteContact: 'Marcus Thorne 0917 000 0000',
      items: [{ equipmentId, start: day(offset, 8), end: day(offset + days - 1, 17) }],
    });
    await bookings.confirmCall(adminCtx, created.id);
    const detail = await bookings.get(customerCtx, created.id);
    return { id: created.id, customerId: detail.customerId };
  }

  function quoteBody(rentalId: string, customerId: string, discount = 0) {
    return {
      customerId,
      projectSiteId: siteId,
      rentalId,
      discount: discount > 0 ? { type: 'fixed' as const, value: discount } : { type: 'none' as const, value: 0 },
      items: [{ equipmentTypeId, rateCardId, quantity: 1, estimatedHours: 8, mobilizationKm: 5, demobilizationKm: 5 }],
    };
  }

  async function notificationTypes(rentalId: string) {
    const rows = await withTenantTx(customerCtx, (tx) =>
      tx.select().from(notifications).where(eq(notifications.userId, customerCtx.userId)),
    );
    return rows
      .filter((row) => (row.payload as { rental_id?: string } | null)?.rental_id === rentalId)
      .map((row) => row.notificationType);
  }

  async function staffAlerts(type: string, rentalId: string) {
    const url = process.env.DATABASE_URL_DIRECT!;
    const sql = postgres(url, { max: 1 });
    const rows = await sql`select count(*)::int as n from notifications where notification_type = ${type} and payload->>'rental_id' = ${rentalId}`;
    await sql.end();
    return (rows[0] as { n: number }).n;
  }


  // A booking is quoted from the price book the moment it is made; staff
  // quote by hand only when that could not price it (no rate card).
  async function priceBookQuote(bookingId: string, customerId: string) {
    const detail = await bookings.get(adminCtx, bookingId);
    if (detail.quotation?.status === 'approved') return quotes.get(adminCtx, detail.quotation.id);
    const quote = await quotes.create(adminCtx, quoteBody(bookingId, customerId));
    await quotes.approve(adminCtx, quote.id);
    return quote;
  }

  it('delivers and returns a paid booking on its own reservation', async () => {
    const booking = await book(0, 2);
    expect(await staffAlerts('booking_requested', booking.id)).toBeGreaterThan(0);

    // Not paid yet: nothing to deliver.
    await expect(bookings.deliver(adminCtx, booking.id)).rejects.toMatchObject({ response: { error: 'booking_not_ready' } });

    const quote = await priceBookQuote(booking.id, booking.customerId);
    await quotes.accept(customerCtx, quote.id);
    expect(await staffAlerts('quote_accepted', booking.id)).toBeGreaterThan(0);
    const checkout = await payments.checkout(customerCtx, booking.id, SIGNED);
    const { rawBody, header } = await checkoutPaidWebhook(adminCtx, checkout.invoiceId, webhookSecret);
    await payments.handleWebhook(rawBody, header, webhookSecret);

    try {
      // Only a timekeeper can be put on the site; the refusal rolls the whole deploy back.
      await expect(
        bookings.deliver(adminCtx, booking.id, { timekeeperUserId: customerCtx.userId }),
      ).rejects.toMatchObject({ response: { error: 'role_has_no_site_assignments' } });
      await bookings.deliver(adminCtx, booking.id, { operatorName: 'Juan Dela Cruz', timekeeperUserId: timekeeperId });
      const [unit] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipment).where(eq(equipment.id, equipmentId)));
      expect(unit?.availabilityStatus).toBe('deployed');
      const assignments = await withTenantTx(adminCtx, (tx) =>
        tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.rentalId, booking.id)),
      );
      expect(assignments.map((a) => a.status)).toEqual(['active']);
      expect(assignments.map((a) => a.operatorName)).toEqual(['Juan Dela Cruz']);
      const onSite = await withTenantTx(adminCtx, (tx) =>
        tx
          .select()
          .from(timekeeperSiteAssignments)
          .where(and(eq(timekeeperSiteAssignments.userId, timekeeperId), eq(timekeeperSiteAssignments.projectSiteId, siteId))),
      );
      expect(onSite).toHaveLength(1);
      expect(await notificationTypes(booking.id)).toContain('equipment_delivered');

      // On site: no cancelling, and delivering twice is refused.
      await expect(bookings.requestChange(customerCtx, booking.id, { kind: 'cancel' })).rejects.toMatchObject({
        response: { error: 'already_on_site' },
      });
      await expect(bookings.deliver(adminCtx, booking.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(bookings.cancel(adminCtx, booking.id)).rejects.toMatchObject({ response: { error: 'already_on_site' } });

      await bookings.markReturned(adminCtx, booking.id);
      const [available] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipment).where(eq(equipment.id, equipmentId)));
      expect(available?.availabilityStatus).toBe('available');
      const returned = await bookings.get(adminCtx, booking.id);
      expect(returned.items[0]).toMatchObject({ returnConditionNotes: null, returnNeedsRepair: false });
    } finally {
      // The unit is shared with other specs; never leave it deployed.
      await withTenantTx(adminCtx, (tx) => tx.update(equipment).set({ availabilityStatus: 'available' }).where(eq(equipment.id, equipmentId)));
    }
    const [rental] = await withTenantTx(adminCtx, (tx) => tx.select().from(rentals).where(eq(rentals.id, booking.id)));
    expect(rental?.status).toBe('completed');
    await expect(bookings.cancel(adminCtx, booking.id)).rejects.toMatchObject({ response: { error: 'booking_closed' } });
    expect(await notificationTypes(booking.id)).toContain('equipment_returned');
    await expect(bookings.requestChange(customerCtx, booking.id, { kind: 'extend', requestedEnd: day(9, 17) })).rejects.toMatchObject({
      response: { error: 'booking_closed' },
    });
  });

  it('tells staff when a customer messages or asks for a change', async () => {
    const booking = await book(5);
    await bookings.postMessage(customerCtx, booking.id, { body: 'Can the truck come at 7?' });
    await bookings.requestChange(customerCtx, booking.id, { kind: 'extend', requestedEnd: day(6, 17) });
    expect(await staffAlerts('customer_message', booking.id)).toBeGreaterThan(0);
    expect(await staffAlerts('change_request_submitted', booking.id)).toBeGreaterThan(0);
    await bookings.cancel(customerCtx, booking.id);
    expect(await notificationTypes(booking.id)).not.toContain('booking_cancelled');
  });

  it('tells the customer when staff cancel their booking', async () => {
    const booking = await book(8);
    await bookings.cancel(adminCtx, booking.id);
    expect(await notificationTypes(booking.id)).toContain('booking_cancelled');
  });

  it('charges an approved extension from the saved hourly rate, increases balance and booked hours, and resolves once', async () => {
    const booking = await book(10);
    const before = await bookings.get(adminCtx, booking.id);
    const assignment = before.items[0]!;
    const request = await bookings.requestChange(customerCtx, booking.id, {
      kind: 'extend', assignmentId: assignment.id, requestedEnd: day(11, 17),
    });
    const { expected, extraHours, bookedHours } = await withTenantTx(adminCtx, async (tx) => {
      const { dailyHours } = await getBillingSettings(tx, adminCtx.tenantId);
      const [unit] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId));
      const [rate] = await tx.select().from(quotationItems).where(and(
        eq(quotationItems.quotationId, before.quotation!.id), eq(quotationItems.equipmentTypeId, unit!.equipmentTypeId),
      ));
      const [row] = await tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.id, assignment.id));
      const hours = minBookingHours(bookingDays(assignment.end!, day(11, 17)), dailyHours);
      return { expected: round2HalfUp(Number(rate!.hourlyRatePhp) * hours), extraHours: hours, bookedHours: Number(row!.bookedHours) };
    });
    expect(expected).toBeGreaterThan(0);
    const billing = new BillingService();
    const balanceBefore = (await billing.statement(customerCtx, booking.id)).totals.balanceDue;
    expect((await bookings.get(adminCtx, booking.id)).changeRequests[0]?.suggestedChargePhp).toBe(expected);
    await bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'approved' });
    const tier = await withTenantTx(adminCtx, (tx) => customerTier(tx, adminCtx.tenantId, booking.customerId));
    expect(tier.hasOverdue).toBe(false);
    expect(tier.eligible).toBe(true);
    const after = await bookings.get(customerCtx, booking.id);
    const charge = after.changeRequests.find((row) => row.id === request.id)!;
    expect(charge).toMatchObject({ chargePhp: expected, status: 'approved', suggestedChargePhp: null });
    expect(after.invoices.find((row) => row.id === charge.invoiceId)).toMatchObject({ invoiceType: 'extension', amount: expected, status: 'issued' });
    expect((await billing.statement(customerCtx, booking.id)).totals.balanceDue).toBeCloseTo(balanceBefore + expected, 2);
    const [unit] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.id, assignment.id)));
    expect(Number(unit?.bookedHours)).toBe(bookedHours + extraHours);
    expect((await payments.checkoutInvoice(customerCtx, charge.invoiceId!)).invoiceId).toBe(charge.invoiceId);
    await expect(bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'approved' })).rejects.toMatchObject({ response: { error: 'change_request_resolved' } });
    expect(after.invoices.filter((row) => row.invoiceType === 'deposit_deduction')).toHaveLength(0);
    await bookings.cancel(customerCtx, booking.id);
  });

  it('suggests the saved hourly charge after the customer accepts, pays and deploys the booking', async () => {
    const booking = await book(2);
    const quote = await priceBookQuote(booking.id, booking.customerId);
    await quotes.accept(customerCtx, quote.id);
    const checkout = await payments.checkout(customerCtx, booking.id, SIGNED);
    const { rawBody, header } = await checkoutPaidWebhook(adminCtx, checkout.invoiceId, webhookSecret);
    await payments.handleWebhook(rawBody, header, webhookSecret);
    try {
      await bookings.deliver(adminCtx, booking.id);
      const before = await bookings.get(adminCtx, booking.id);
      expect(before.quotation?.status).toBe('accepted');
      const assignment = before.items[0]!;
      const request = await bookings.requestChange(customerCtx, booking.id, {
        kind: 'extend', assignmentId: assignment.id, requestedEnd: day(3, 17),
      });
      const expected = await withTenantTx(adminCtx, async (tx) => {
        const { dailyHours } = await getBillingSettings(tx, adminCtx.tenantId);
        const [unit] = await tx.select().from(equipment).where(eq(equipment.id, equipmentId));
        const [rate] = await tx.select().from(quotationItems).where(and(
          eq(quotationItems.quotationId, quote.id), eq(quotationItems.equipmentTypeId, unit!.equipmentTypeId),
        ));
        return round2HalfUp(Number(rate!.hourlyRatePhp) * minBookingHours(bookingDays(assignment.end!, day(3, 17)), dailyHours));
      });
      expect(expected).toBeGreaterThan(0);
      expect((await bookings.get(adminCtx, booking.id)).changeRequests[0]?.suggestedChargePhp).toBe(expected);
      await bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'approved' });
      expect((await bookings.get(customerCtx, booking.id)).changeRequests[0]?.chargePhp).toBe(expected);
      await bookings.markReturned(adminCtx, booking.id);
    } finally {
      await withTenantTx(adminCtx, (tx) => tx.update(equipment).set({ availabilityStatus: 'available' }).where(eq(equipment.id, equipmentId)));
    }
  });

  it('requires an override reason and records the agreed charge and reason without changing dates on refusal', async () => {
    const booking = await book(13);
    const before = await bookings.get(adminCtx, booking.id);
    const assignment = before.items[0]!;
    const request = await bookings.requestChange(customerCtx, booking.id, { kind: 'extend', assignmentId: assignment.id, requestedEnd: day(14, 17) });
    await expect(bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'approved', chargePhp: 123.45 }))
      .rejects.toMatchObject({ response: { error: 'charge_reason_required' } });
    const refused = await bookings.get(adminCtx, booking.id);
    expect(refused.items[0]?.end).toEqual(assignment.end);
    expect(refused.invoices.filter((row) => row.invoiceType === 'extension')).toHaveLength(0);
    expect(refused.changeRequests[0]?.status).toBe('pending');
    await bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'approved', chargePhp: 123.45, chargeReason: 'Agreed with customer' });
    const after = await bookings.get(adminCtx, booking.id);
    expect(after.changeRequests[0]?.chargePhp).toBe(123.45);
    expect(after.invoices.find((row) => row.invoiceType === 'extension')?.amount).toBe(123.45);
    const [audit] = await withTenantTx(adminCtx, (tx) => tx.select().from(auditLogs).where(and(
      eq(auditLogs.entityId, request.id), eq(auditLogs.action, 'APPROVE'),
    )));
    expect(audit?.reason).toBe('Agreed with customer');
    await bookings.cancel(customerCtx, booking.id);
  });

  it('requires an explicit charge when no accepted quotation rate exists and permits a reasoned free extension', async () => {
    const booking = await book(16);
    await withTenantTx(adminCtx, (tx) => tx.update(quotations).set({ status: 'draft' }).where(eq(quotations.rentalId, booking.id)));
    const before = await bookings.get(adminCtx, booking.id);
    const request = await bookings.requestChange(customerCtx, booking.id, { kind: 'extend', assignmentId: before.items[0]!.id, requestedEnd: day(17, 17) });
    const [original] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.id, before.items[0]!.id)));
    const { dailyHours } = await withTenantTx(adminCtx, (tx) => getBillingSettings(tx, adminCtx.tenantId));
    expect((await bookings.get(adminCtx, booking.id)).changeRequests[0]?.suggestedChargePhp).toBeNull();
    await expect(bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'approved' }))
      .rejects.toMatchObject({ response: { error: 'extension_charge_required' } });
    expect((await bookings.get(adminCtx, booking.id)).items[0]?.end).toEqual(before.items[0]?.end);
    await bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'approved', chargePhp: 0 });
    const after = await bookings.get(adminCtx, booking.id);
    expect(after.changeRequests[0]).toMatchObject({ chargePhp: 0, invoiceId: null });
    expect(after.invoices).toHaveLength(0);
    const [extended] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.id, before.items[0]!.id)));
    const extraHours = minBookingHours(bookingDays(before.items[0]!.end!, day(17, 17)), dailyHours);
    expect(Number(extended?.bookedHours)).toBe(Number(original?.bookedHours) + extraHours);
    const chargedRequest = await bookings.requestChange(customerCtx, booking.id, { kind: 'extend', assignmentId: before.items[0]!.id, requestedEnd: day(18, 17) });
    await bookings.resolveChange(adminCtx, booking.id, chargedRequest.id, { decision: 'approved', chargePhp: 125 });
    const charged = await bookings.get(adminCtx, booking.id);
    expect(charged.changeRequests.find((row) => row.id === chargedRequest.id)?.chargePhp).toBe(125);
    expect(charged.invoices.find((row) => row.invoiceType === 'extension')?.amount).toBe(125);
    await bookings.cancel(customerCtx, booking.id);
  });

  it('rejects an extension without creating an invoice or changing booked hours', async () => {
    const booking = await book(19);
    const before = await bookings.get(adminCtx, booking.id);
    const request = await bookings.requestChange(customerCtx, booking.id, { kind: 'extend', assignmentId: before.items[0]!.id, requestedEnd: day(20, 17) });
    await bookings.resolveChange(adminCtx, booking.id, request.id, { decision: 'rejected' });
    const after = await bookings.get(adminCtx, booking.id);
    expect(after.items[0]?.end).toEqual(before.items[0]?.end);
    expect(after.changeRequests[0]).toMatchObject({ status: 'rejected', chargePhp: null, invoiceId: null });
    expect(after.invoices).toHaveLength(0);
    await bookings.cancel(customerCtx, booking.id);
  });

  it('requires complete logs or an audited confirmation, validates units, and stores repair condition without billing it', async () => {
    const booking = await book(22);
    const assignment = (await bookings.get(adminCtx, booking.id)).items[0]!;
    const foreign = await book(25);
    const foreignAssignment = (await bookings.get(adminCtx, foreign.id)).items[0]!;
    const start = new Date(Date.now() - 3 * 86_400_000);
    const end = new Date(Date.now() - 86_400_000);
    await withTenantTx(adminCtx, async (tx) => {
      await tx.update(rentals).set({ status: 'active', startDate: start, endDate: end }).where(eq(rentals.id, booking.id));
      await tx.update(equipmentAssignments).set({ status: 'active', start, end }).where(eq(equipmentAssignments.id, assignment.id));
      await tx.update(equipment).set({ availabilityStatus: 'deployed' }).where(eq(equipment.id, equipmentId));
    });
    try {
      await expect(bookings.markReturned(adminCtx, booking.id, { units: [{ assignmentId: foreignAssignment.id }] }))
        .rejects.toMatchObject({ response: { error: 'booking_unit_not_found' } });
      await expect(bookings.markReturned(adminCtx, booking.id)).rejects.toMatchObject({ response: { error: 'field_logs_incomplete' } });
      await expect(bookings.markReturned(adminCtx, booking.id, { confirmIncompleteLogs: true }))
        .rejects.toMatchObject({ response: { error: 'field_logs_incomplete' } });
      expect((await bookings.get(adminCtx, booking.id)).status).toBe('active');
      await bookings.markReturned(adminCtx, booking.id, {
        units: [{ assignmentId: assignment.id, conditionNotes: 'Hydraulic leak', needsRepair: true }],
        confirmIncompleteLogs: true, reason: 'Paper logs still at site',
      });
      const after = await bookings.get(adminCtx, booking.id);
      expect(after.status).toBe('completed');
      expect(after.items[0]).toMatchObject({ returnConditionNotes: 'Hydraulic leak', returnNeedsRepair: true });
      expect(after.invoices).toHaveLength(0);
      const [unit] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipment).where(eq(equipment.id, equipmentId)));
      expect(unit?.availabilityStatus).toBe('maintenance');
      const audits = await withTenantTx(adminCtx, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, booking.id)));
      expect(audits.find((row) => row.entity === 'return_with_incomplete_field_logs')?.reason).toContain('Paper logs still at site');
      const [repairAudit] = await withTenantTx(adminCtx, (tx) => tx.select().from(auditLogs).where(and(eq(auditLogs.entityId, equipmentId), eq(auditLogs.reason, 'flagged for repair on return'))));
      expect(repairAudit?.entity).toBe('equipment');
      expect(await staffAlerts('equipment_needs_repair', booking.id)).toBeGreaterThan(0);
      await expect(bookings.markReturned(adminCtx, booking.id)).rejects.toMatchObject({ response: { error: 'booking_not_on_site' } });
      const [stillRepair] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipment).where(eq(equipment.id, equipmentId)));
      expect(stillRepair?.availabilityStatus).toBe('maintenance');
    } finally {
      await withTenantTx(adminCtx, (tx) => tx.update(equipment).set({ availabilityStatus: 'available' }).where(eq(equipment.id, equipmentId)));
      // Keep the fixture in this suite's July cleanup range after exercising past field-log days.
      await withTenantTx(adminCtx, async (tx) => {
        await tx.update(equipmentAssignments).set({ start: assignment.start, end: assignment.end }).where(eq(equipmentAssignments.id, assignment.id));
        await tx.update(rentals).set({ startDate: assignment.start }).where(eq(rentals.id, booking.id));
      });
      await bookings.cancel(customerCtx, foreign.id);
    }
  });

  it('preserves a per-unit repair flag when the whole booking is later marked returned', async () => {
    const booking = await book(28);
    const assignment = (await bookings.get(adminCtx, booking.id)).items[0]!;
    await withTenantTx(adminCtx, async (tx) => {
      await tx.update(rentals).set({ status: 'active' }).where(eq(rentals.id, booking.id));
      await tx.update(equipmentAssignments).set({ status: 'active' }).where(eq(equipmentAssignments.id, assignment.id));
      await tx.update(equipment).set({ availabilityStatus: 'deployed' }).where(eq(equipment.id, equipmentId));
    });
    try {
      await new SitesService(events).returnDeployment(adminCtx, siteId, assignment.id, { needsRepair: true, conditionNotes: 'Track needs replacement' });
      await bookings.markReturned(adminCtx, booking.id);
      const after = await bookings.get(adminCtx, booking.id);
      expect(after.status).toBe('completed');
      expect(after.items[0]).toMatchObject({ returnNeedsRepair: true, returnConditionNotes: 'Track needs replacement' });
      const [unit] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipment).where(eq(equipment.id, equipmentId)));
      expect(unit?.availabilityStatus).toBe('maintenance');
    } finally {
      await withTenantTx(adminCtx, (tx) => tx.update(equipment).set({ availabilityStatus: 'available' }).where(eq(equipment.id, equipmentId)));
    }
  });

  it('keeps a machine unavailable if any of its returned assignment windows needs repair', async () => {
    const booking = await bookings.create(customerCtx, {
      customerId: fixtureCustomerId, projectSiteId: siteId,
      items: [
        { equipmentId, start: day(26, 8), end: day(26, 17) },
        { equipmentId, start: day(27, 8), end: day(27, 17) },
      ],
    });
    const assignments = (await bookings.get(adminCtx, booking.id)).items;
    await withTenantTx(adminCtx, async (tx) => {
      await tx.update(rentals).set({ status: 'active' }).where(eq(rentals.id, booking.id));
      await tx.update(equipmentAssignments).set({ status: 'active' }).where(eq(equipmentAssignments.rentalId, booking.id));
      await tx.update(equipment).set({ availabilityStatus: 'deployed' }).where(eq(equipment.id, equipmentId));
    });
    try {
      await bookings.markReturned(adminCtx, booking.id, { units: [{ assignmentId: assignments[0]!.id, needsRepair: true }] });
      const [unit] = await withTenantTx(adminCtx, (tx) => tx.select().from(equipment).where(eq(equipment.id, equipmentId)));
      expect(unit?.availabilityStatus).toBe('maintenance');
      expect((await bookings.get(adminCtx, booking.id)).items.map((item) => item.returnNeedsRepair)).toEqual([true, false]);
    } finally {
      await withTenantTx(adminCtx, (tx) => tx.update(equipment).set({ availabilityStatus: 'available' }).where(eq(equipment.id, equipmentId)));
    }
  });
});
