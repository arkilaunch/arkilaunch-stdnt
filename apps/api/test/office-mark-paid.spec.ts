import type { QuotesService } from '../src/quotes/quotes.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import { auditLogs, invoices, payments as paymentRows, rentals, truckRequests, withTenantTx } from '@arkilaunch/db';
import { StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { PaymentsService } from '../src/payments/payments.service.js';
import { TrucksService } from '../src/trucks/trucks.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { BillingService } from '../src/billing/billing.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';
import { fixtureCompanyId } from './fixture-company.js';

// QA 34: a walk-in pays at the office; staff mark it paid (optional OR) and can deploy or dispatch next.
describe('Office mark-as-paid', () => {
  const events = new EventsService();
  const payments = new PaymentsService(new StubPaymentsAdapter(), events);
  const trucks = new TrucksService(new PricingEngineService(), payments);
  const bookings = new BookingsService(events, { autoQuoteBooking: async () => null } as unknown as QuotesService, payments);
  const billing = new BillingService();
  let customerCtx: RequestContext;
  let adminCtx: RequestContext;
  let otherTenantCtx: RequestContext;
  let siteId: string;
  let equipmentId: string;
  let companyId: string;

  const ageCheckouts = async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    await sql`update payments set created_at = created_at - interval '10 minutes' where tenant_id = ${adminCtx.tenantId} and created_at > now() - interval '5 minutes'`;
    await sql.end();
  };
  afterAll(ageCheckouts);

  beforeAll(async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    const [a] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [b] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const tenantId = (a as { id: string }).id;
    const [customer] = await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [admin] = await sql`select u.id from users u join roles r on r.id = u.role_id where u.tenant_id = ${tenantId} and r.name = 'admin' and u.status = 'active' limit 1`;
    const [otherAdmin] = await sql`select u.id from users u join roles r on r.id = u.role_id where u.tenant_id = ${(b as { id: string }).id} and r.name = 'admin' limit 1`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} and customer_id is null order by created_at limit 1`;
    const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
    customerCtx = { tenantId, userId: (customer as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    otherTenantCtx = { tenantId: (b as { id: string }).id, userId: (otherAdmin as { id: string }).id, role: 'admin' };
    companyId = await fixtureCompanyId(sql, tenantId);
    siteId = (site as { id: string }).id;
    equipmentId = (unit as { id: string }).id;
    // Rerun-safe: clear this spec's 2034 bookings of the fixture unit.
    const stale = await sql`select rental_id from equipment_assignments where equipment_id = ${equipmentId} and start >= '2034-01-01' and start < '2035-01-01'`;
    const ids = stale.map((r) => (r as { rental_id: string }).rental_id);
    if (ids.length) {
      await sql`delete from equipment_assignments where rental_id = any(${ids})`;
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from invoices where rental_id = any(${ids})`;
      await sql`delete from rentals where id = any(${ids})`;
    }
    await sql.end();
    await ageCheckouts();
  });

  const agreedTrip = async () => {
    const [row] = await withTenantTx(customerCtx, (tx) =>
      tx.insert(truckRequests).values({
        tenantId: customerCtx.tenantId,
        requestedBy: customerCtx.userId,
        pickup: 'Pililla, Rizal',
        dropoff: 'Taytay, Rizal',
        scheduledFor: new Date(Date.now() + 86_400_000),
        estimatedKm: '35',
        price: { km: 35, lines: [], totalPhp: 12000 },
        capPhp: '13000',
        // Stored route: dispatch then never calls the public routers.
        routeMinutes: 70,
        routeCities: [],
      }).returning(),
    );
    await trucks.agree(adminCtx, row!.id, 12000);
    return row!.id;
  };

  it('settles a trip paid in person, without the call or in-app accept, and keeps the OR', async () => {
    const id = await agreedTrip();
    expect(await payments.markPaidAtOffice(adminCtx, 'truck', id, 'OR-0001234')).toMatchObject({ status: 'paid' });

    const [trip] = await withTenantTx(adminCtx, (tx) => tx.select().from(truckRequests).where(eq(truckRequests.id, id)));
    expect(trip!.status).toBe('paid');
    const [invoice] = await withTenantTx(adminCtx, (tx) => tx.select().from(invoices).where(eq(invoices.truckRequestId, id)));
    expect(invoice).toMatchObject({ status: 'paid', amount: '12000.00' });
    const [payment] = await withTenantTx(adminCtx, (tx) => tx.select().from(paymentRows).where(eq(paymentRows.invoiceId, invoice!.id)));
    expect(payment).toMatchObject({ method: 'cash', status: 'paid', receiptNo: 'OR-0001234', recordedByUserId: adminCtx.userId });
    expect((await billing.getInvoice(adminCtx, invoice!.id)).receiptNo).toBe('OR-0001234');
    const audit = await withTenantTx(adminCtx, (tx) =>
      tx.select().from(auditLogs).where(and(eq(auditLogs.entity, 'truck_requests'), eq(auditLogs.entityId, id))));
    expect(audit.some((a) => a.reason?.includes('paid at the office') && a.reason.includes('OR-0001234'))).toBe(true);

    // Paid once: a second tap is refused, and dispatch is the next step.
    await expect(payments.markPaidAtOffice(adminCtx, 'truck', id)).rejects.toMatchObject({ response: { error: 'already_paid' } });
    expect((await trucks.dispatch(adminCtx, id)).status).toBe('dispatched');
  });

  it('still refuses a trip with no agreed price, a cancelled one, and another tenant', async () => {
    const [fresh] = await withTenantTx(customerCtx, (tx) =>
      tx.insert(truckRequests).values({
        tenantId: customerCtx.tenantId, requestedBy: customerCtx.userId, pickup: 'Pasig', dropoff: 'Makati',
        scheduledFor: new Date(Date.now() + 86_400_000), estimatedKm: '12', price: { km: 12, lines: [], totalPhp: 1000 }, capPhp: '1100',
      }).returning(),
    );
    await expect(payments.markPaidAtOffice(adminCtx, 'truck', fresh!.id)).rejects.toMatchObject({ response: { error: 'price_not_agreed' } });

    const cancelled = await agreedTrip();
    await withTenantTx(adminCtx, (tx) => tx.update(truckRequests).set({ status: 'cancelled' }).where(eq(truckRequests.id, cancelled)));
    await expect(payments.markPaidAtOffice(adminCtx, 'truck', cancelled)).rejects.toMatchObject({ response: { error: 'price_not_agreed' } });

    const id = await agreedTrip();
    await expect(payments.markPaidAtOffice(otherTenantCtx, 'truck', id)).rejects.toMatchObject({ response: { error: 'truck_request_not_found' } });
  });

  it('confirms a rental paid in person without the phone call, ready to deploy', async () => {
    const start = new Date(Date.UTC(2034, 0, 5, 8)).toISOString();
    const end = new Date(Date.UTC(2034, 0, 5, 17)).toISOString();
    const created = await bookings.create(customerCtx, { customerId: companyId, projectSiteId: siteId, items: [{ equipmentId, start, end }] });
    await expect(payments.checkout(customerCtx, created.id, { cash: true })).rejects.toMatchObject({ response: { error: 'call_not_confirmed' } });

    await payments.markPaidAtOffice(adminCtx, 'rental', created.id);
    const [rental] = await withTenantTx(adminCtx, (tx) => tx.select().from(rentals).where(eq(rentals.id, created.id)));
    expect(rental!.status).toBe('confirmed');
    const paid = await withTenantTx(adminCtx, (tx) => tx.select().from(invoices).where(eq(invoices.rentalId, created.id)));
    expect(paid.map((i) => i.status)).toEqual(['paid']);
  });
});
