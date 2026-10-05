import { beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import { equipment, equipmentAssignments, projectSites, rentals, withTenantTx } from '@arkilaunch/db';
import { manilaDate, type RequestContext } from '@arkilaunch/shared';
import { EventsService } from '../src/events/events.service.js';
import { FieldSheetsService } from '../src/edtr/field-sheets.service.js';
import { EdtrService } from '../src/edtr/edtr.service.js';

// QA 32: field logs go only against machines on site now, at the timekeeper's own sites.
describe('eDTR scan targets', () => {
  const events = new EventsService();
  const sheets = new FieldSheetsService(events);
  const edtr = new EdtrService(events);
  let timekeeper: RequestContext;
  let admin: RequestContext;
  let otherTenantAdmin: RequestContext;
  let rentalId: string;
  let onSite: string;
  let notDelivered: string;
  let returned: string;
  let elsewhere: string;
  let unassignedRentalId: string;

  beforeAll(async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    const ctxFor = async (slug: string, role: string) => {
      const [row] = await sql`select u.id, u.tenant_id from users u join roles r on r.id = u.role_id join tenants t on t.id = u.tenant_id
        where t.slug = ${slug} and r.name = ${role} and u.status = 'active' limit 1`;
      const r = row as { id: string; tenant_id: string };
      return { tenantId: r.tenant_id, userId: r.id, role } as RequestContext;
    };
    timekeeper = await ctxFor('test-tenant-a', 'timekeeper');
    admin = await ctxFor('test-tenant-a', 'admin');
    otherTenantAdmin = await ctxFor('test-tenant-b', 'admin');
    await sql.end();

    await withTenantTx(admin, async (tx) => {
      // The fixture's first site carries the timekeeper's assignment and an active rental.
      const [site] = await tx.select().from(projectSites).limit(1);
      const [rental] = await tx.select().from(rentals)
        .where(and(eq(rentals.projectSiteId, site!.id), eq(rentals.status, 'active'))).limit(1);
      const [anyUnit] = await tx.select().from(equipment).limit(1);
      rentalId = rental!.id;
      const stamp = Date.now();
      const unit = async (serial: string, rental: string, assignment: Partial<typeof equipmentAssignments.$inferInsert>) => {
        const [u] = await tx.insert(equipment).values({
          tenantId: admin.tenantId, equipmentTypeId: anyUnit!.equipmentTypeId, model: 'Scan target unit', serialNo: `${serial}-${stamp}`,
        }).returning();
        await tx.insert(equipmentAssignments).values({
          tenantId: admin.tenantId, equipmentId: u!.id, rentalId: rental, start: new Date(Date.now() - 3 * 86_400_000), ...assignment,
        });
        return u!.id;
      };
      onSite = await unit('on-site', rentalId, { status: 'active' });
      notDelivered = await unit('in-yard', rentalId, { status: 'scheduled' });
      returned = await unit('returned', rentalId, { status: 'completed', end: new Date(Date.now() - 86_400_000) });
      const [lonely] = await tx.insert(projectSites)
        .values({ tenantId: admin.tenantId, addressId: site!.addressId, latitude: '14.600000', longitude: '121.000000' }).returning();
      const [other] = await tx.insert(rentals).values({
        tenantId: admin.tenantId, customerId: rental!.customerId, projectSiteId: lonely!.id, status: 'active', startDate: new Date(Date.now() - 5 * 86_400_000),
      }).returning();
      unassignedRentalId = other!.id;
      elsewhere = await unit('elsewhere', unassignedRentalId, { status: 'active' });
    });
  });

  const unitsOf = (items: Awaited<ReturnType<FieldSheetsService['scanTargets']>>['items']) => items.flatMap((t) => t.units.map((u) => u.equipmentId));

  it('offers a timekeeper only machines on site now, at their own sites', async () => {
    const { items } = await sheets.scanTargets(timekeeper);
    const units = unitsOf(items);
    expect(units).toContain(onSite);
    expect(units).not.toContain(notDelivered);
    expect(units).not.toContain(returned);
    expect(units).not.toContain(elsewhere);
    expect(items.some((t) => t.rentalId === unassignedRentalId)).toBe(false);
    const target = items.find((t) => t.rentalId === rentalId)!;
    expect(target.siteName).not.toBe('');
    expect(target.units.every((u) => u.onSite)).toBe(true);
  });

  it('offers staff every site, plus units returned in the last 14 days for late paper', async () => {
    const units = unitsOf((await sheets.scanTargets(admin)).items);
    expect(units).toEqual(expect.arrayContaining([onSite, returned, elsewhere]));
    expect(units).not.toContain(notDelivered);
    expect(unitsOf((await sheets.scanTargets(otherTenantAdmin)).items)).not.toContain(onSite);
  });

  it('refuses a timekeeper log for a machine not on site, and takes one that is', async () => {
    const day = manilaDate(new Date());
    const log = (equipmentId: string, ctx = timekeeper) =>
      edtr.capture(ctx, { source: 'digital_entry', rentalId, equipmentId, reportDate: day, lineItems: { hoursActive: 8, hoursIdle: 0 } });
    await expect(log(notDelivered)).rejects.toMatchObject({ response: { error: 'equipment_not_deployed' } });
    await expect(log(returned)).rejects.toMatchObject({ response: { error: 'equipment_not_deployed' } });
    await expect(log(elsewhere)).rejects.toMatchObject({ response: { error: 'equipment_not_deployed' } });
    expect((await log(onSite)).id).toBeTruthy();
  });
});
