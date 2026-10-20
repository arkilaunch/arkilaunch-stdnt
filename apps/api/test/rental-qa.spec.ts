import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { equipmentAssignments, withTenantTx } from '@arkilaunch/db';
import { DamageAssessmentCreateSchema, StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { RentalQaService } from '../src/rental-qa/rental-qa.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { EventsService } from '../src/events/events.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { BillingService } from '../src/billing/billing.service.js';
import { fixtureCompanyId } from './fixture-company.js';
import { PDFDocument } from 'pdf-lib';
import { TINY_PNG } from './signed.js';

describe('Rental QA tenant isolation and financial controls', () => {
  const service = new RentalQaService();
  const events = new EventsService();
  const bookings = new BookingsService(events, new QuotesService(new PricingEngineService(), events), new PaymentsService(new StubPaymentsAdapter(), events));
  const billing = new BillingService();
  const rentalIds: string[] = [];
  const equipmentIds: string[] = [];
  const clause = 'The customer is liable for documented negligent damage, subject to an agreed repair estimate.';
  let direct: postgres.Sql;
  let admin: RequestContext;
  let owner: RequestContext;
  let otherOwner: RequestContext;
  let customerId: string;
  let customerUserId: string;
  let siteId: string;
  let typeId: string;
  let originalPromotions: Awaited<ReturnType<RentalQaService['promotions']>>;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('rental-qa.spec.ts requires a seeded throwaway local PostgreSQL DATABASE_URL_DIRECT; remote databases are intentionally refused');
    }
    direct = postgres(url, { max: 1 });
    const [tenant] = await direct`select id from tenants where slug='test-tenant-a'`;
    const [otherTenant] = await direct`select id from tenants where slug='test-tenant-b'`;
    if (!tenant || !otherTenant) throw new Error('Run seed:test-two-tenant before the rental QA integration suite');
    const tenantId = String(tenant.id);
    const [user] = await direct`select id from users where tenant_id=${tenantId} and email='admin@test-tenant-a.test'`;
    const [otherUser] = await direct`select id from users where tenant_id=${String(otherTenant.id)} and email='admin@test-tenant-b.test'`;
    const [customerUser] = await direct`select id from users where tenant_id=${tenantId} and email='customer@test-tenant-a.test'`;
    const [site] = await direct`select id from project_sites where tenant_id=${tenantId} order by created_at limit 1`;
    const [type] = await direct`select equipment_type_id from equipment where tenant_id=${tenantId} limit 1`;
    admin = { tenantId, userId: String(user!.id), role: 'admin' };
    owner = { ...admin, role: 'owner' };
    otherOwner = { tenantId: String(otherTenant.id), userId: String(otherUser!.id), role: 'owner' };
    customerId = await fixtureCompanyId(direct, tenantId);
    customerUserId = String(customerUser!.id);
    siteId = String(site!.id);
    typeId = String(type!.equipment_type_id);
    originalPromotions = await service.promotions(admin);
  });

  afterAll(async () => {
    if (!direct) return;
    try {
      if (originalPromotions) await service.savePromotions(admin, originalPromotions);
      if (rentalIds.length) {
        await direct`delete from damage_assessments where rental_id=any(${rentalIds})`;
        await direct`delete from invoice_line_items where invoice_id in (select id from invoices where rental_id=any(${rentalIds}))`;
        await direct`delete from payments where invoice_id in (select id from invoices where rental_id=any(${rentalIds}))`;
        await direct`delete from invoices where rental_id=any(${rentalIds})`;
        await direct`delete from rental_contracts where quotation_id in (select id from quotations where rental_id=any(${rentalIds}))`;
        await direct`delete from rental_agreements where rental_id=any(${rentalIds})`;
        await direct`delete from quotations where rental_id=any(${rentalIds})`;
        await direct`delete from equipment_assignments where rental_id=any(${rentalIds})`;
        await direct`delete from rentals where id=any(${rentalIds})`;
      }
      if (equipmentIds.length) await direct`delete from equipment where id=any(${equipmentIds})`;
    } finally { await direct.end(); }
  });

  async function fixture(status = 'completed', condition = 'damaged') {
    const start = new Date(Date.now() - 3600000);
    const end = new Date(Date.now() + 86400000);
    const [rental] = await direct`insert into rentals(tenant_id,customer_id,project_site_id,status,start_date,end_date)
      values(${admin.tenantId},${customerId},${siteId},${status},${start},${end}) returning id`;
    const rentalId = String(rental!.id);
    rentalIds.push(rentalId);
    const assignment = await addUnit(rentalId, start, end, status === 'completed' ? 'completed' : 'scheduled', condition);
    const [agreement] = await direct`insert into rental_agreements(tenant_id,rental_id,customer_id,user_id,terms_version,terms_body,signed_name,signature_png)
      values(${admin.tenantId},${rentalId},${customerId},${customerUserId},'qa-v1',${`Rental agreement. ${clause} Normal wear is excluded.`},'QA Customer',${TINY_PNG}) returning id`;
    return { rentalId, assignmentId: assignment.assignmentId, equipmentId: assignment.equipmentId, agreementId: String(agreement!.id) };
  }

  async function addUnit(rentalId: string, start: Date, end: Date, status = 'scheduled', condition = 'good') {
    const [unit] = await direct`insert into equipment(tenant_id,equipment_type_id,model,serial_no)
      values(${admin.tenantId},${typeId},'Rental QA isolated unit',${`rental-qa-${randomUUID()}`}) returning id`;
    const equipmentId = String(unit!.id);
    equipmentIds.push(equipmentId);
    const [assignment] = await direct`insert into equipment_assignments(tenant_id,rental_id,equipment_id,start,"end",status,return_condition,return_needs_repair,return_condition_notes)
      values(${admin.tenantId},${rentalId},${equipmentId},${start},${end},${status},${condition},${condition === 'damaged'},'Inspection notes retained') returning id`;
    return { assignmentId: String(assignment!.id), equipmentId };
  }

  function assessment(input: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
    return DamageAssessmentCreateSchema.parse({ assignmentId: input.assignmentId, agreementId: input.agreementId,
      notes: 'Guard cracked on return; replacement estimate attached.', evidence: 'Inspection photographs and estimate QA-42; customer confirmed by email.',
      contractClause: clause, amount: 2450.25, customerAgreed: true, ...extra });
  }

  it('isolates configured and public promotions between tenants', async () => {
    const otherBefore = await service.promotions(otherOwner);
    const value = { equipment: { enabled: true, amount: 820.25, unit: 'hour' as const, qualification: 'QA promotion for selected machines.' }, trucking: null };
    await service.savePromotions(admin, value);
    expect(await service.promotions(admin)).toEqual(value);
    expect(await service.publicPromotions('test-tenant-a')).toEqual(value);
    expect(await service.promotions(otherOwner)).toEqual(otherBefore);
    expect(await service.publicPromotions('test-tenant-b')).toEqual(otherBefore);
  });

  it('requires a returned damage candidate and an exact clause from this booking’s signed snapshot', async () => {
    const input = await fixture();
    await expect(service.create(admin, input.rentalId, assessment(input, { contractClause: 'An invented liability clause not signed by the customer.' })))
      .rejects.toMatchObject({ response: { error: 'signed_contract_clause_required' } });
    const other = await fixture();
    await expect(service.create(admin, input.rentalId, assessment(input, { agreementId: other.agreementId })))
      .rejects.toMatchObject({ response: { error: 'signed_contract_clause_required' } });
    const servicing = await fixture('completed', 'servicing');
    await expect(service.create(admin, servicing.rentalId, assessment(servicing)))
      .rejects.toMatchObject({ response: { error: 'returned_damage_required' } });
    const pending = await service.create(admin, input.rentalId, assessment(input));
    expect(pending).toMatchObject({ status: 'pending', amount: '2450.25', invoiceId: null });
    await expect(service.create(admin, input.rentalId, assessment(input))).rejects.toMatchObject({ response: { error: 'damage_assessment_exists' } });
  });

  it('enforces Owner approval, creates one seven-day damage invoice, and leaves deposits unchanged', async () => {
    const input = await fixture();
    const [quote] = await direct`insert into quotations(tenant_id,customer_id,rental_id) values(${admin.tenantId},${customerId},${input.rentalId}) returning id`;
    await direct`insert into rental_contracts(tenant_id,quotation_id,deposit_required) values(${admin.tenantId},${String(quote!.id)},5000)`;
    await direct`insert into invoices(tenant_id,rental_id,invoice_type,amount,status,due_date) values(${admin.tenantId},${input.rentalId},'deposit',5000,'paid',now())`;
    const ledgerBefore = await billing.depositLedger(admin, input.rentalId);
    const pending = (await service.create(admin, input.rentalId, assessment(input)))!;
    await expect(service.resolve(admin, input.rentalId, pending.id, { decision: 'approved', reason: 'Reviewed.' }))
      .rejects.toMatchObject({ response: { error: 'owner_approval_required' } });
    await expect(service.list(otherOwner, input.rentalId)).rejects.toMatchObject({ response: { error: 'booking_not_found' } });
    await expect(service.resolve(otherOwner, input.rentalId, pending.id, { decision: 'approved', reason: 'Reviewed.' }))
      .rejects.toMatchObject({ response: { error: 'assessment_not_found' } });
    const hidden = await withTenantTx(otherOwner, (tx) => tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.rentalId, input.rentalId)));
    expect(hidden).toEqual([]);
    const before = Date.now();
    const approved = await service.resolve(owner, input.rentalId, pending.id, { decision: 'approved', reason: 'Signed clause, estimate and customer consent verified.' });
    const after = Date.now();
    expect(approved).toMatchObject({ status: 'approved', amount: '2450.25' });
    const [invoice] = await direct`select id,amount,invoice_type,due_date from invoices where id=${approved!.invoiceId!}`;
    expect(invoice).toMatchObject({ amount: '2450.25', invoice_type: 'damage' });
    expect(new Date(invoice!.due_date).getTime()).toBeGreaterThanOrEqual(before + 7 * 86400000);
    expect(new Date(invoice!.due_date).getTime()).toBeLessThanOrEqual(after + 7 * 86400000);
    const [line] = await direct`select quantity,unit_price,amount from invoice_line_items where invoice_id=${String(invoice!.id)}`;
    expect(Number(line!.quantity)).toBe(1);
    expect(line!.unit_price).toBe('2450.25');
    expect(line!.amount).toBe('2450.25');
    await expect(service.resolve(owner, input.rentalId, pending.id, { decision: 'approved', reason: 'Retry request.' }))
      .rejects.toMatchObject({ response: { error: 'assessment_resolved' } });
    const [count] = await direct`select count(*)::int n from invoices where rental_id=${input.rentalId} and invoice_type='damage'`;
    expect(count!.n).toBe(1);
    expect(await billing.depositLedger(admin, input.rentalId)).toEqual(ledgerBefore);
    const [deductions] = await direct`select count(*)::int n from invoices where rental_id=${input.rentalId} and invoice_type='deposit_deduction'`;
    expect(deductions!.n).toBe(0);
  });

  it('rejection records the decision without issuing an invoice', async () => {
    const input = await fixture();
    const pending = (await service.create(admin, input.rentalId, assessment(input)))!;
    expect(await service.resolve(owner, input.rentalId, pending.id, { decision: 'rejected', reason: 'Inspection shows normal wear; no customer liability.' }))
      .toMatchObject({ status: 'rejected', invoiceId: null });
    const [count] = await direct`select count(*)::int n from invoices where rental_id=${input.rentalId}`;
    expect(count!.n).toBe(0);
  });

  it('deploys selected due equipment, then remaining due units while future units stay scheduled', async () => {
    const input = await fixture('confirmed');
    const now = Date.now();
    const second = await addUnit(input.rentalId, new Date(now - 3600000), new Date(now + 86400000));
    const future = await addUnit(input.rentalId, new Date(now + 3 * 86400000), new Date(now + 4 * 86400000));
    await expect(bookings.deliver(admin, input.rentalId, { assignmentIds: [future.assignmentId] }))
      .rejects.toMatchObject({ response: { error: 'equipment_outside_booked_window' } });
    await bookings.deliver(admin, input.rentalId, { assignmentIds: [input.assignmentId], operatorName: 'Selected operator' });
    let assignments = await withTenantTx(admin, (tx) => tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.rentalId, input.rentalId)));
    expect(assignments.find((a) => a.id === input.assignmentId)).toMatchObject({ status: 'active', operatorName: 'Selected operator' });
    expect(assignments.find((a) => a.id === second.assignmentId)?.status).toBe('scheduled');
    await bookings.deliver(admin, input.rentalId);
    assignments = await withTenantTx(admin, (tx) => tx.select().from(equipmentAssignments).where(eq(equipmentAssignments.rentalId, input.rentalId)));
    expect(assignments.find((a) => a.id === second.assignmentId)?.status).toBe('active');
    expect(assignments.find((a) => a.id === future.assignmentId)?.status).toBe('scheduled');
    await expect(bookings.deliver(admin, input.rentalId)).rejects.toMatchObject({ response: { error: 'nothing_to_deliver' } });
    await expect(bookings.deliver(otherOwner, input.rentalId)).rejects.toMatchObject({ response: { error: 'booking_not_found' } });
  });

  it('rolls the entire bulk deployment back when one due machine is unavailable', async () => {
    const input = await fixture('confirmed');
    const blocked = await addUnit(input.rentalId, new Date(Date.now() - 3600000), new Date(Date.now() + 86400000));
    await direct`update equipment set availability_status='maintenance' where id=${blocked.equipmentId}`;
    await expect(bookings.deliver(admin, input.rentalId)).rejects.toMatchObject({ response: { error: 'equipment_unavailable' } });
    const statuses = await direct`select status from equipment_assignments where rental_id=${input.rentalId}`;
    expect(statuses.map((row) => row.status)).toEqual(['scheduled', 'scheduled']);
    const [rental] = await direct`select status from rentals where id=${input.rentalId}`;
    const [unit] = await direct`select availability_status from equipment where id=${input.equipmentId}`;
    expect(rental!.status).toBe('confirmed');
    expect(unit!.availability_status).toBe('available');
  });

  it('authorizes invoice, receipt and signed agreement downloads by customer ownership and tenant', async () => {
    const input = await fixture();
    const customer = { tenantId: admin.tenantId, userId: customerUserId, role: 'customer' } satisfies RequestContext;
    const stranger = { ...admin, role: 'customer' } satisfies RequestContext;
    const [invoice] = await direct`insert into invoices(tenant_id,rental_id,invoice_type,amount,status,due_date)
      values(${admin.tenantId},${input.rentalId},'damage',1250.25,'issued',now()) returning id`;
    const invoiceId = String(invoice!.id);
    const ownInvoice = await billing.invoicePdf(customer, invoiceId);
    expect((await PDFDocument.load(Buffer.from(ownInvoice.contentBase64, 'base64'))).getTitle()).toBe(`Invoice ${invoiceId}`);
    await expect(billing.invoicePdf(stranger, invoiceId)).rejects.toMatchObject({ response: { error: 'invoice_not_found' } });
    await expect(billing.invoicePdf(otherOwner, invoiceId)).rejects.toMatchObject({ response: { error: 'invoice_not_found' } });
    await expect(billing.invoicePdf(customer, invoiceId, true)).rejects.toMatchObject({ response: { error: 'successful_payment_not_found' } });
    await direct`insert into payments(tenant_id,invoice_id,method,amount,status,receipt_no)
      values(${admin.tenantId},${invoiceId},'cash',1250.25,'paid','OR-RENTAL-QA-DOWNLOAD')`;
    const receipt = await billing.invoicePdf(customer, invoiceId, true);
    expect((await PDFDocument.load(Buffer.from(receipt.contentBase64, 'base64'))).getTitle()).toBe(`Payment receipt ${invoiceId}`);
    await expect(billing.invoicePdf(stranger, invoiceId, true)).rejects.toMatchObject({ response: { error: 'invoice_not_found' } });
    const agreement = await billing.agreementPdf(customer, input.rentalId);
    expect((await PDFDocument.load(Buffer.from(agreement.contentBase64, 'base64'))).getTitle()).toContain('Signed rental agreement');
    await expect(billing.agreementPdf(stranger, input.rentalId)).rejects.toMatchObject({ response: { error: 'booking_not_found' } });
    await expect(billing.agreementPdf(otherOwner, input.rentalId)).rejects.toMatchObject({ response: { error: 'booking_not_found' } });
  });

  it('retains the signed terms snapshot when current tenant terms change', async () => {
    const input = await fixture();
    const customer = { tenantId: admin.tenantId, userId: customerUserId, role: 'customer' } satisfies RequestContext;
    const [before] = await direct`select * from rental_terms_settings where tenant_id=${admin.tenantId}`;
    try {
      await direct`insert into rental_terms_settings(tenant_id,body,version,updated_by)
        values(${admin.tenantId},'Replacement current terms: no original clause.',777,${admin.userId})
        on conflict(tenant_id) do update set body=excluded.body,version=excluded.version`;
      const [stored] = await direct`select terms_body,terms_version,signature_png from rental_agreements where id=${input.agreementId}`;
      expect(stored!.terms_body).toBe(`Rental agreement. ${clause} Normal wear is excluded.`);
      expect(stored!.terms_version).toBe('qa-v1');
      expect(stored!.signature_png).toBe(TINY_PNG);
      const snapshot = (await service.list(admin, input.rentalId)).agreements[0]!;
      expect(snapshot.body).toContain(clause);
      expect(snapshot.version).toBe('qa-v1');
      const pdf = await billing.agreementPdf(customer, input.rentalId);
      expect((await PDFDocument.load(Buffer.from(pdf.contentBase64, 'base64'))).getTitle()).toContain('Signed rental agreement');
    } finally {
      if (before) {
        await direct`update rental_terms_settings set body=${String(before.body)},version=${Number(before.version)},updated_by=${before.updated_by ?? null},updated_at=${before.updated_at} where tenant_id=${admin.tenantId}`;
      } else await direct`delete from rental_terms_settings where tenant_id=${admin.tenantId}`;
    }
  });

  it('returns only deployed machines, retains maintenance notes, then explicitly cancels the scheduled remainder', async () => {
    const input = await fixture('confirmed');
    const future = await addUnit(input.rentalId, new Date(Date.now() + 3 * 86400000), new Date(Date.now() + 4 * 86400000));
    await bookings.deliver(admin, input.rentalId, { assignmentIds: [input.assignmentId] });
    expect(await bookings.markReturned(admin, input.rentalId, {
      units: [{ assignmentId: input.assignmentId, condition: 'servicing', conditionNotes: 'Hydraulic hose requires inspection; retain these notes.' }],
      confirmIncompleteLogs: true, reason: 'QA return with field log verification pending.',
    })).toMatchObject({ status: 'active' });
    const [returned] = await direct`select status,return_condition,return_condition_notes,return_needs_repair from equipment_assignments where id=${input.assignmentId}`;
    expect(returned).toMatchObject({ status: 'completed', return_condition: 'servicing', return_condition_notes: 'Hydraulic hose requires inspection; retain these notes.', return_needs_repair: true });
    const [machine] = await direct`select availability_status from equipment where id=${input.equipmentId}`;
    expect(machine!.availability_status).toBe('maintenance');
    const [scheduled] = await direct`select status from equipment_assignments where id=${future.assignmentId}`;
    expect(scheduled!.status).toBe('scheduled');
    expect(await bookings.markReturned(admin, input.rentalId, { cancelScheduled: true, reason: 'Customer cancelled the undeployed remainder.' })).toMatchObject({ status: 'completed' });
    const [cancelled] = await direct`select status from equipment_assignments where id=${future.assignmentId}`;
    expect(cancelled!.status).toBe('cancelled');
    const [audit] = await direct`select reason from audit_logs where entity='rentals' and entity_id=${input.rentalId} and reason like 'Cancelled undeployed remainder:%'`;
    expect(audit!.reason).toContain('Customer cancelled the undeployed remainder.');
  });
});
