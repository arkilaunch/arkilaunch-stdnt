import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { runReturnReminders } from './return-reminders.js';

// QA §2: reminders before a machine's return date at each tenant's points (default 5, 3, 1),
// one message per booking per point, once when overdue; an extension re-arms them.
describe('return-reminders', () => {
  const sql = postgres(process.env.DATABASE_URL_DIRECT ?? '', { max: 1 });
  // 2039-03-10 09:00 Manila: far from every other spec's bookings.
  const now = new Date('2039-03-10T01:00:00Z');
  const later = (days: number) => new Date(now.getTime() + days * 86_400_000);
  const startedAt = new Date();
  const made: string[] = [];
  type Fixture = { tenantId: string; customerId: string; siteId: string; units: string[] };
  let a: Fixture;
  let b: Fixture;

  async function fixture(slug: string): Promise<Fixture> {
    const [tenant] = await sql`select id from tenants where slug = ${slug}`;
    const tenantId = (tenant as { id: string }).id;
    const [customer] = await sql`select id from customers where tenant_id = ${tenantId} and user_id is not null order by created_at limit 1`;
    const [site] = await sql`select id from project_sites where tenant_id = ${tenantId} order by created_at limit 1`;
    const units = await sql`select id from equipment where tenant_id = ${tenantId} order by serial_no`;
    return {
      tenantId,
      customerId: (customer as { id: string }).id,
      siteId: (site as { id: string }).id,
      units: units.map((u) => (u as { id: string }).id),
    };
  }

  // `day` is the Manila calendar date of the return; machines are due back at 17:00.
  async function rental(f: Fixture, ends: { unit: number; day: string; status?: string }[]) {
    const [row] = await sql`
      insert into rentals (tenant_id, customer_id, project_site_id, status, start_date, end_date)
      values (${f.tenantId}, ${f.customerId}, ${f.siteId}, 'active', '2039-03-01T08:00:00+08:00', ${`${ends.at(-1)!.day}T17:00:00+08:00`})
      returning id`;
    const id = (row as { id: string }).id;
    made.push(id);
    const assignments: string[] = [];
    for (const e of ends) {
      const [asg] = await sql`
        insert into equipment_assignments (tenant_id, equipment_id, rental_id, start, "end", status)
        values (${f.tenantId}, ${f.units[e.unit]!}, ${id}, '2039-03-01T08:00:00+08:00', ${`${e.day}T17:00:00+08:00`}, ${e.status ?? 'active'})
        returning id`;
      assignments.push((asg as { id: string }).id);
    }
    return { id, assignments };
  }

  type Sent = { type: string; audience: string; threshold: string; machines: number; user_tenant: string };
  const sentFor = async (rentalId: string) =>
    (await sql`
      select n.notification_type as type, n.payload->>'audience' as audience, n.payload->>'threshold' as threshold,
             jsonb_array_length(n.payload->'machines') as machines, u.tenant_id as user_tenant
      from notifications n join users u on u.id = n.user_id
      where n.notification_type in ('return_reminder', 'return_overdue') and n.payload->>'rental_id' = ${rentalId}
      order by n.created_at, n.payload->>'audience'`) as unknown as Sent[];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_DIRECT) throw new Error('DATABASE_URL_DIRECT is required');
    a = await fixture('test-tenant-a');
    b = await fixture('test-tenant-b');
    await sql`delete from return_reminder_settings where tenant_id in (${a.tenantId}, ${b.tenantId})`;
  });

  afterAll(async () => {
    await sql`delete from return_reminder_settings where tenant_id in (${a.tenantId}, ${b.tenantId})`;
    // The sweep also reaches other specs' leftover live bookings; drop every reminder it wrote.
    await sql`delete from notifications where notification_type in ('return_reminder', 'return_overdue') and created_at >= ${startedAt}`;
    if (made.length) {
      await sql`delete from equipment_assignments where rental_id in ${sql(made)}`;
      await sql`delete from rentals where id in ${sql(made)}`;
    }
    await sql.end();
  });

  it('sends one grouped reminder per booking to the customer and staff, once', async () => {
    const both = await rental(a, [
      { unit: 0, day: '2039-03-15' },
      { unit: 1, day: '2039-03-15' },
    ]);
    const lateBooking = await rental(a, [{ unit: 0, day: '2039-03-14' }]); // 4 days: catches up on the 5-day point
    const returned = await rental(a, [{ unit: 1, day: '2039-03-13', status: 'completed' }]);
    const notYet = await rental(a, [{ unit: 1, day: '2039-03-16' }]); // 6 days: no point yet

    const { sent } = await runReturnReminders(now);
    expect(sent).toEqual(expect.arrayContaining([both.id, lateBooking.id]));

    const told = await sentFor(both.id);
    expect(told.map((t) => t.audience)).toEqual(expect.arrayContaining(['customer', 'staff']));
    expect(told.every((t) => t.type === 'return_reminder' && t.threshold === '5' && t.machines === 2)).toBe(true);
    expect(told.every((t) => t.user_tenant === a.tenantId)).toBe(true);
    expect((await sentFor(lateBooking.id)).map((t) => t.threshold)).toContain('5');
    expect(await sentFor(returned.id)).toEqual([]);
    expect(await sentFor(notYet.id)).toEqual([]);

    await runReturnReminders(now);
    expect(await sentFor(both.id)).toHaveLength(told.length);

    // Two days on, the 3-day point fires; the 5-day one does not repeat.
    await runReturnReminders(later(2));
    expect((await sentFor(both.id)).filter((t) => t.threshold === '3')).toHaveLength(told.length);
    expect((await sentFor(both.id)).filter((t) => t.threshold === '5')).toHaveLength(told.length);
  });

  it('re-arms after an extension moves the return date', async () => {
    const extended = await rental(a, [{ unit: 0, day: '2039-03-15' }]);
    await runReturnReminders(now);
    const before = (await sentFor(extended.id)).length;
    expect(before).toBeGreaterThan(0);

    await sql`update equipment_assignments set "end" = '2039-03-17T17:00:00+08:00' where id = ${extended.assignments[0]!}`;
    await runReturnReminders(now); // 7 days out: nothing on the default points
    expect(await sentFor(extended.id)).toHaveLength(before);
    await runReturnReminders(later(2)); // 5 days before the new date
    expect((await sentFor(extended.id)).filter((t) => t.threshold === '5')).toHaveLength(before * 2);
  });

  it('alerts overdue once', async () => {
    const overdue = await rental(a, [{ unit: 1, day: '2039-03-09' }]);
    await runReturnReminders(now);
    const told = await sentFor(overdue.id);
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((t) => t.type === 'return_overdue' && t.threshold === 'overdue')).toBe(true);
    await runReturnReminders(later(1));
    expect(await sentFor(overdue.id)).toHaveLength(told.length);
  });

  it("follows each tenant's own points and overdue switch", async () => {
    await sql`insert into return_reminder_settings (tenant_id, days_before, overdue) values (${b.tenantId}, '{7}', false)`;
    await sql`insert into return_reminder_settings (tenant_id, days_before, overdue) values (${a.tenantId}, '{}', true)`;
    const weekOut = await rental(b, [{ unit: 0, day: '2039-03-17' }]);
    const overdueB = await rental(b, [{ unit: 1, day: '2039-03-09' }]);
    const tomorrowA = await rental(a, [{ unit: 0, day: '2039-03-11' }]);
    const overdueA = await rental(a, [{ unit: 1, day: '2039-03-08' }]);

    await runReturnReminders(now);

    const toldB = await sentFor(weekOut.id);
    expect(toldB.length).toBeGreaterThan(0);
    expect(toldB.every((t) => t.threshold === '7' && t.user_tenant === b.tenantId)).toBe(true);
    expect(await sentFor(overdueB.id)).toEqual([]);
    expect(await sentFor(tomorrowA.id)).toEqual([]);
    expect((await sentFor(overdueA.id)).every((t) => t.type === 'return_overdue')).toBe(true);
  });
});
