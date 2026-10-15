import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import postgres from 'postgres';
import { StubPaymentsAdapter, type RequestContext } from '@arkilaunch/shared';
import { BookingsController } from '../src/bookings/bookings.controller.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { QuotesService } from '../src/quotes/quotes.service.js';
import { PricingEngineService } from '../src/quotes/pricing-engine.service.js';
import { EventsService } from '../src/events/events.service.js';

// QA §2: staff see machines due back within the tenant's widest reminder point, overdue first,
// and the tenant's reminder settings fall back to 5, 3, 1 + overdue.
describe('Return reminders: settings and returns due', () => {
  const events = new EventsService();
  const bookings = new BookingsService(
    events,
    new QuotesService(new PricingEngineService(), events),
    new PaymentsService(new StubPaymentsAdapter(), new EventsService()),
  );
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
  // 2038-03-10 09:00 Manila: far from every other spec's bookings.
  const now = new Date('2038-03-10T01:00:00Z');
  const made: string[] = [];
  let adminA: RequestContext;
  let adminB: RequestContext;
  let tenantA: string;
  let tenantB: string;

  async function fixture(slug: string) {
    const [tenant] = await sql`select id from tenants where slug = ${slug}`;
    const tenantId = (tenant as { id: string }).id;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email = ${`admin@${slug}.test`}`;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} and user_id is not null order by created_at limit 1`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} order by created_at limit 1`;
    const units = await sql`select id from equipment where tenant_id = ${tenantId} order by serial_no`;
    return {
      tenantId,
      ctx: { tenantId, userId: (admin as { id: string }).id, role: 'admin' } as RequestContext,
      customerId: (customer as { id: string }).id,
      siteId: (site as { id: string }).id,
      units: units.map((u) => (u as { id: string }).id),
    };
  }

  let a: Awaited<ReturnType<typeof fixture>>;
  let b: Awaited<ReturnType<typeof fixture>>;

  async function rental(f: typeof a, status: string, ends: { unit: number; end: string; status?: string }[]) {
    const [row] = await sql`
      insert into rentals (tenant_id, customer_id, project_site_id, status, start_date, end_date)
      values (${f.tenantId}, ${f.customerId}, ${f.siteId}, ${status}, '2038-03-01T08:00:00+08:00', ${ends.at(-1)!.end})
      returning id`;
    const id = (row as { id: string }).id;
    made.push(id);
    const assignments: string[] = [];
    for (const e of ends) {
      const [asg] = await sql`
        insert into equipment_assignments (tenant_id, equipment_id, rental_id, start, "end", status)
        values (${f.tenantId}, ${f.units[e.unit]!}, ${id}, '2038-03-01T08:00:00+08:00', ${e.end}, ${e.status ?? 'active'})
        returning id`;
      assignments.push((asg as { id: string }).id);
    }
    return { id, assignments };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_DIRECT) throw new Error('DATABASE_URL_DIRECT is required');
    a = await fixture('test-tenant-a');
    b = await fixture('test-tenant-b');
    adminA = a.ctx;
    adminB = b.ctx;
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    await sql`delete from return_reminder_settings where tenant_id in (${tenantA}, ${tenantB})`;
  });

  afterAll(async () => {
    await sql`delete from return_reminder_settings where tenant_id in (${tenantA}, ${tenantB})`;
    if (made.length) {
      await sql`delete from equipment_assignments where rental_id in ${sql(made)}`;
      await sql`delete from rentals where id in ${sql(made)}`;
    }
    await sql.end();
  });

  it('keeps the routes staff-only and the settings write to tenant managers', () => {
    // report:read is admin + owner only; customers and timekeepers never hold it.
    const reflector = new Reflector();
    expect(reflector.get(PERMISSION_KEY, BookingsController.prototype.returnsDue)).toEqual(['report:read']);
    expect(reflector.get(PERMISSION_KEY, BookingsController.prototype.returnReminders)).toEqual(['report:read']);
    expect(reflector.get(PERMISSION_KEY, BookingsController.prototype.saveReturnReminders)).toEqual(['tenant:manage']);
  });

  it('returns the baseline when the tenant has saved nothing', async () => {
    expect(await bookings.getReturnReminders(adminA)).toEqual({ daysBefore: [5, 3, 1], overdue: true });
  });

  it('saves the tenant settings and keeps them to that tenant', async () => {
    expect(await bookings.saveReturnReminders(adminA, { daysBefore: [1, 7], overdue: false })).toEqual({ daysBefore: [7, 1], overdue: false });
    expect(await bookings.getReturnReminders(adminA)).toEqual({ daysBefore: [7, 1], overdue: false });
    expect(await bookings.getReturnReminders(adminB)).toEqual({ daysBefore: [5, 3, 1], overdue: true });
    await expect(sql`insert into return_reminder_settings (tenant_id, days_before) values (${tenantB}, '{4}')`).rejects.toThrow(
      /return_reminder_settings_days_chk/,
    );
    await sql`delete from return_reminder_settings where tenant_id = ${tenantA}`;
  });

  it('lists live machines due within the window, overdue first, for this tenant only', async () => {
    const due = await rental(a, 'active', [
      { unit: 0, end: '2038-03-09T17:00:00+08:00' }, // overdue by 1 day
      { unit: 1, end: '2038-03-13T17:00:00+08:00' }, // due in 3 days
    ]);
    const later = await rental(a, 'active', [{ unit: 0, end: '2038-03-17T17:00:00+08:00' }]); // 7 days
    const returned = await rental(a, 'active', [{ unit: 1, end: '2038-03-11T17:00:00+08:00', status: 'completed' }]);
    const other = await rental(b, 'active', [{ unit: 0, end: '2038-03-12T17:00:00+08:00' }]);

    const mine = (r: { items: { rentalId: string }[] }) =>
      r.items.filter((i) => [due.id, later.id, returned.id, other.id].includes(i.rentalId));

    const base = await bookings.returnsDue(adminA, now);
    expect(base.windowDays).toBe(5);
    expect(mine(base).map((i) => [i.assignmentId, i.daysLeft])).toEqual([
      [due.assignments[0], -1],
      [due.assignments[1], 3],
    ]);
    expect(mine(base)[0]!.equipmentLabel).toContain('SN ');

    await bookings.saveReturnReminders(adminA, { daysBefore: [7], overdue: true });
    const wide = await bookings.returnsDue(adminA, now);
    expect(wide.windowDays).toBe(7);
    expect(mine(wide).map((i) => i.rentalId)).toEqual([due.id, due.id, later.id]);

    await bookings.saveReturnReminders(adminA, { daysBefore: [], overdue: true });
    expect(mine(await bookings.returnsDue(adminA, now)).map((i) => i.daysLeft)).toEqual([-1]);
    await sql`delete from return_reminder_settings where tenant_id = ${tenantA}`;

    expect(mine(await bookings.returnsDue(adminB, now)).map((i) => i.rentalId)).toEqual([other.id]);
  });
});
