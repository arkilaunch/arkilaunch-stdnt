import type { QuotesService } from '../src/quotes/quotes.service.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { rentalAgreements, rentals, withTenantTx } from '@arkilaunch/db';
import { AgreementSignSchema, DEFAULT_RENTAL_TERMS, StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { BookingsController } from '../src/bookings/bookings.controller.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { EventsService } from '../src/events/events.service.js';
import { PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator.js';
import { fixtureCompanyId } from './fixture-company.js';
import { SIGNED, TINY_PNG } from './signed.js';

// QA §3 (Mr. Violeta): the customer signs the tenant's rental agreement at checkout, before any money moves.
describe('Rental agreement at checkout', () => {
  const events = new EventsService();
  const payments = new PaymentsService(new StubPaymentsAdapter(), events);
  const bookings = new BookingsService(events, { autoQuoteBooking: async () => null } as unknown as QuotesService, payments);
  let customerCtx: RequestContext;
  let adminCtx: RequestContext;
  let adminB: RequestContext;
  let companyId: string;
  let siteId: string;
  let equipmentId: string;

  async function db<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    try {
      return await fn(sql);
    } finally {
      await sql.end();
    }
  }

  // Same tenant-wide checkout throttle as payments-engine.spec.ts.
  const ageCheckouts = () =>
    db((sql) => sql`update payments set created_at = created_at - interval '10 minutes' where tenant_id = ${customerCtx.tenantId} and created_at > now() - interval '5 minutes'`);

  beforeAll(async () => {
    await db(async (sql) => {
      const [a] = await sql`select id from tenants where slug = 'test-tenant-a'`;
      const [b] = await sql`select id from tenants where slug = 'test-tenant-b'`;
      const tenantId = (a as { id: string }).id;
      const tenantB = (b as { id: string }).id;
      const [customer] = await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
      const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
      const [adminUserB] = await sql`select id from users where tenant_id = ${tenantB} and email = 'admin@test-tenant-b.test'`;
      const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} and customer_id is null order by created_at limit 1`;
      const [unit] = await sql`select id from equipment where tenant_id = ${tenantId} and serial_no = 'test-tenant-a-serial-booking-001'`;
      customerCtx = { tenantId, userId: (customer as { id: string }).id, role: 'customer' };
      adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
      adminB = { tenantId: tenantB, userId: (adminUserB as { id: string }).id, role: 'admin' };
      companyId = await fixtureCompanyId(sql, tenantId);
      siteId = (site as { id: string }).id;
      equipmentId = (unit as { id: string }).id;

      await clearOwnRows(sql, tenantB);
    });
    await ageCheckouts();
  });

  // Agreement rows hold an FK on their rental, so leftovers would block other specs' booking cleanup;
  // later specs also check out against the template version.
  afterAll(async () => {
    await db((sql) => clearOwnRows(sql));
    await ageCheckouts();
  });

  async function clearOwnRows(sql: postgres.Sql, alsoTenant?: string) {
    const stale = await sql`select rental_id from equipment_assignments where equipment_id = ${equipmentId} and start >= '2036-01-01' and start < '2037-01-01'`;
    const ids = stale.map((row) => (row as { rental_id: string }).rental_id);
    if (ids.length > 0) {
      await sql`delete from rental_agreements where rental_id = any(${ids})`;
      await sql`delete from equipment_assignments where rental_id = any(${ids})`;
      await sql`delete from payments where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from invoice_line_items where invoice_id in (select id from invoices where rental_id = any(${ids}))`;
      await sql`delete from invoices where rental_id = any(${ids})`;
      await sql`delete from rentals where id = any(${ids})`;
    }
    await sql`delete from rental_terms_settings where tenant_id = ${customerCtx.tenantId}`;
    if (alsoTenant) await sql`delete from rental_terms_settings where tenant_id = ${alsoTenant}`;
  }

  async function readyBooking(day: number): Promise<string> {
    const start = new Date(Date.UTC(2036, 0, day, 8)).toISOString();
    const end = new Date(Date.UTC(2036, 0, day, 17)).toISOString();
    const created = await bookings.create(customerCtx, { customerId: companyId, projectSiteId: siteId, items: [{ equipmentId, start, end }] });
    await withTenantTx(customerCtx, (tx) => tx.update(rentals).set({ callConfirmedAt: new Date() }).where(eq(rentals.id, created.id)));
    return created.id;
  }

  const agreementsFor = (rentalId: string) =>
    withTenantTx(adminCtx, (tx) => tx.select().from(rentalAgreements).where(eq(rentalAgreements.rentalId, rentalId)));

  it('lets customers read the terms and only tenant managers change them', () => {
    const reflector = new Reflector();
    expect(reflector.get(PERMISSION_KEY, BookingsController.prototype.rentalTerms)).toEqual(['booking:read']);
    expect(reflector.get(PERMISSION_KEY, BookingsController.prototype.saveRentalTerms)).toEqual(['tenant:manage']);
  });

  it('refuses to charge until the agreement is signed, then records it once', async () => {
    const id = await readyBooking(2);
    await expect(payments.checkout(customerCtx, id, { method: 'qrph' })).rejects.toMatchObject({ response: { error: 'agreement_required' } });
    expect(await agreementsFor(id)).toHaveLength(0);

    await payments.checkout(customerCtx, id, { method: 'qrph', ...SIGNED }, undefined, false, { ip: '203.0.113.7', userAgent: 'vitest' });
    const [row] = await agreementsFor(id);
    expect(row).toMatchObject({ signedName: 'Test Signer', termsVersion: 'default-1', termsBody: DEFAULT_RENTAL_TERMS.body, ip: '203.0.113.7', userAgent: 'vitest', userId: customerCtx.userId });

    // A retry (here: switching to pay offline) needs no new signature and adds no row.
    await payments.checkout(customerCtx, id, { cash: true });
    expect(await agreementsFor(id)).toHaveLength(1);
    expect((await bookings.get(customerCtx, id)).agreement).toMatchObject({ signedName: 'Test Signer', termsVersion: 'default-1', signaturePng: TINY_PNG });
  });

  it('versions tenant terms, keeps them to the tenant, and refuses a signature on stale text', async () => {
    expect(await bookings.getRentalTerms(customerCtx)).toEqual(DEFAULT_RENTAL_TERMS);
    const body = 'Tenant A rental terms. '.repeat(20);
    expect(await bookings.saveRentalTerms(adminCtx, { body })).toMatchObject({ version: 'v1', isDefault: false });
    expect(await bookings.saveRentalTerms(adminCtx, { body: `${body} Amended.` })).toMatchObject({ version: 'v2' });
    expect(await bookings.getRentalTerms(adminB)).toEqual(DEFAULT_RENTAL_TERMS);

    const id = await readyBooking(4);
    await expect(payments.checkout(customerCtx, id, { method: 'qrph', ...SIGNED })).rejects.toMatchObject({
      response: { error: 'terms_changed', version: 'v2' },
    });
    await payments.checkout(customerCtx, id, { method: 'qrph', agreement: { ...SIGNED.agreement, termsVersion: 'v2' } });
    expect((await agreementsFor(id))[0]).toMatchObject({ termsVersion: 'v2', termsBody: `${body} Amended.` });
  });

  it('accepts only a PNG data URL within the size cap as a signature', () => {
    const sign = (signaturePng: string) => AgreementSignSchema.safeParse({ ...SIGNED.agreement, signaturePng }).success;
    expect(sign(TINY_PNG)).toBe(true);
    expect(sign('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(sign('data:image/png;base64,R0lGODlhAQABAAAAACw=')).toBe(false);
    expect(sign(`${TINY_PNG}${'A'.repeat(140_000)}`)).toBe(false);
  });
});
