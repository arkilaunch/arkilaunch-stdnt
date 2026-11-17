import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { rentals, truckRequests, withTenantTx } from '@arkilaunch/db';
import { BookingListQuerySchema, StubPaymentsAdapter, TruckRequestListQuerySchema, type RequestContext } from '@arkilaunch/shared';
import type { QuotesService } from '../src/quotes/quotes.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { TrucksService } from '../src/trucks/trucks.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { EventsService } from '../src/events/events.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';

describe('admin booking expiration', () => {
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
  const events = new EventsService();
  const payments = new PaymentsService(new StubPaymentsAdapter(), events);
  const bookings = new BookingsService(events, { autoQuoteBooking: async () => null } as unknown as QuotesService, payments);
  const trucks = new TrucksService(new PricingEngineService(), payments);
  let ctx: RequestContext;
  let rentalId: string;
  let rentalCode: string;
  let truckId: string;
  let truckCode: string;
  let paidTruckId: string;
  let paidTruckCode: string;

  beforeAll(async () => {
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = 'admin@test-tenant-a.test'`;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} order by created_at limit 1`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} order by created_at limit 1`;
    ctx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    const yesterday = new Date(Date.now() - 86_400_000);
    const pastHour = new Date(Date.now() - 3_600_000);
    const [rental] = await withTenantTx(ctx, (tx) => tx.insert(rentals).values({
      tenantId, customerId: (customer as { id: string }).id, projectSiteId: (site as { id: string }).id,
      status: 'pending', startDate: yesterday, endDate: new Date(Date.now() + 86_400_000),
    }).returning({ id: rentals.id, code: rentals.code }));
    rentalId = rental!.id;
    rentalCode = rental!.code;
    const [truck] = await withTenantTx(ctx, (tx) => tx.insert(truckRequests).values({
      tenantId, requestedBy: ctx.userId, customerId: (customer as { id: string }).id,
      pickup: 'Pasig City', dropoff: 'Makati City', scheduledFor: pastHour,
      estimatedKm: '12', price: { km: 12, lines: [], totalPhp: 1000 }, status: 'estimated',
    }).returning({ id: truckRequests.id, code: truckRequests.code }));
    truckId = truck!.id;
    truckCode = truck!.code;
    const [paid] = await withTenantTx(ctx, (tx) => tx.insert(truckRequests).values({
      tenantId, requestedBy: ctx.userId, customerId: (customer as { id: string }).id,
      pickup: 'Pasig City', dropoff: 'Makati City', scheduledFor: pastHour,
      estimatedKm: '12', price: { km: 12, lines: [], totalPhp: 1000 }, status: 'paid',
    }).returning({ id: truckRequests.id, code: truckRequests.code }));
    paidTruckId = paid!.id;
    paidTruckCode = paid!.code;
  });

  afterAll(async () => {
    if (rentalId) await sql`delete from rentals where id = ${rentalId}`;
    const truckIds = [truckId, paidTruckId].filter(Boolean);
    if (truckIds.length) await sql`delete from truck_requests where id in ${sql(truckIds)}`;
    await sql.end();
  });

  it('moves an unpaid rental to History and closes checkout', async () => {
    const query = (bucket: 'active' | 'history') => BookingListQuerySchema.parse({ q: rentalCode, bucket });
    expect((await bookings.list(ctx, query('active'))).items).toHaveLength(0);
    expect((await bookings.list(ctx, query('history'))).items).toEqual([expect.objectContaining({ id: rentalId, status: 'expired' })]);
    await expect(payments.checkout(ctx, rentalId, {}, undefined, true)).rejects.toMatchObject({ response: { error: 'booking_closed', status: 'expired' } });
  });

  it('expires an unpaid truck at its scheduled instant but keeps paid work active', async () => {
    await expect(payments.checkoutTruck(ctx, truckId, {}, undefined, true)).rejects.toMatchObject({ response: { error: 'booking_expired' } });
    const query = (code: string, bucket: 'active' | 'history') => TruckRequestListQuerySchema.parse({ q: code, bucket });
    expect((await trucks.list(ctx, 'all', query(truckCode, 'active'))).items).toHaveLength(0);
    expect((await trucks.list(ctx, 'all', query(truckCode, 'history'))).items).toEqual([expect.objectContaining({ id: truckId, status: 'expired' })]);
    expect((await trucks.list(ctx, 'all', query(paidTruckCode, 'active'))).items).toEqual([expect.objectContaining({ id: paidTruckId, status: 'paid' })]);
  });
});
