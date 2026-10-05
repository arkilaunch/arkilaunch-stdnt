import { describe, expect, it, beforeAll } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import postgres from 'postgres';
import { PDFDocument } from 'pdf-lib';
import { addDaysIso, manilaDate, LeakageReportQuerySchema, type RequestContext } from '@arkilaunch/shared';
import {
  customers, edtr, edtrLineItems, edtrReconciliations, equipment, equipmentAssignments, invoices, payments,
  projectSites, rateCards, rentals, withTenantTx,
} from '@arkilaunch/db';
import { daysInWindow, severityOf } from '../src/fleet/leakage-report.js';
import { FleetService } from '../src/fleet/fleet.service.js';
import { EventsService } from '../src/events/events.service.js';
import { FleetController } from '../src/fleet/fleet.controller.js';
import { PermissionsGuard } from '../src/common/guards/permissions.guard.js';
import { PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator.js';

describe('Revenue leakage report', () => {
  const fleet = new FleetService(new EventsService());
  let ctxA: RequestContext;
  let ctxB: RequestContext;
  let typeIds: string[];

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [a] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const [b] = await sql`select id from tenants where slug = 'test-tenant-b'`;
    const [adminA] = await sql`select id from users where tenant_id = ${a!.id} limit 1`;
    const [adminB] = await sql`select id from users where tenant_id = ${b!.id} limit 1`;
    typeIds = (await sql`select id from equipment_types order by name limit 2`).map((r) => r.id as string);
    ctxA = { tenantId: a!.id, userId: adminA!.id, role: 'admin' };
    ctxB = { tenantId: b!.id, userId: adminB!.id, role: 'admin' };
    await sql.end();
  });

  it('ranks every leak by pesos, and the totals add up', async () => {
    const r = await fleet.leakageReport(ctxA, {});
    expect(r.findings.map((f) => f.key).sort()).toEqual(
      ['cash_pending', 'discounts', 'disputed_hours', 'idle_fleet', 'missing_logs', 'overdue', 'overstay', 'unbilled_hours', 'unreadable'],
    );
    // Owed or lost money ranks by pesos; missed opportunity always comes last.
    const owed = r.findings.filter((f) => f.kind !== 'opportunity').map((f) => f.amountPhp);
    expect(owed).toEqual([...owed].sort((x, y) => y - x));
    expect(r.findings.at(-1)!.kind).toBe('opportunity');
    const { lost, delayed, opportunity, total } = r.summary.atRisk;
    expect(total).toBeCloseTo(lost + delayed + opportunity, 2);
    expect(r.summary.topActions.length).toBeLessThanOrEqual(3);
    for (const f of r.findings) {
      expect(f.whyItMatters.length).toBeGreaterThan(40);
      expect(f.whatToDo.length).toBeGreaterThan(20);
      expect(f.records.length).toBeLessThanOrEqual(5);
    }
  });

  // QA 35: a customer of its own, so the pesos are exact: unit rate PHP 1,000/h, out on site for the last 10 days.
  it('prices the leaks it finds: unbilled hours, days with no log, overdue invoices and unrecorded cash', async () => {
    const today = manilaDate(new Date());
    const from = addDaysIso(today, -9);
    const seeded = await withTenantTx(ctxA, async (tx) => {
      const [site] = await tx.select().from(projectSites).limit(1);
      const [company] = await tx.insert(customers).values({ tenantId: ctxA.tenantId, companyName: `Leakage Co ${Date.now()}` }).returning();
      const [unit] = await tx.insert(equipment).values({
        tenantId: ctxA.tenantId, equipmentTypeId: typeIds[0]!, model: 'Leak test unit', serialNo: `leak-${Date.now()}`, availabilityStatus: 'deployed',
      }).returning();
      await tx.insert(rateCards).values({
        tenantId: ctxA.tenantId, equipmentTypeId: typeIds[0]!, equipmentId: unit!.id, rateType: 'hourly', rateValue: '1000.00', effectiveFrom: new Date('2020-01-01'),
      });
      const [rental] = await tx.insert(rentals).values({
        tenantId: ctxA.tenantId, customerId: company!.id, projectSiteId: site!.id, status: 'active', startDate: new Date(`${from}T08:00:00+08:00`),
      }).returning();
      await tx.insert(equipmentAssignments).values({
        tenantId: ctxA.tenantId, equipmentId: unit!.id, rentalId: rental!.id, start: new Date(`${from}T08:00:00+08:00`), status: 'active',
      });
      // Day one was logged and approved, then never billed.
      const [log] = await tx.insert(edtr).values({
        tenantId: ctxA.tenantId, rentalId: rental!.id, equipmentId: unit!.id, source: 'digital_entry', reportDate: from, status: 'reconciled',
      }).returning();
      await tx.insert(edtrLineItems).values({ tenantId: ctxA.tenantId, edtrId: log!.id, hoursActive: '8.00', hoursIdle: '0.00' });
      const [paper] = await tx.insert(edtr).values({
        tenantId: ctxA.tenantId, rentalId: rental!.id, equipmentId: unit!.id, source: 'paper_ocr', reportDate: from, status: 'reconciled',
      }).returning();
      await tx.insert(edtrLineItems).values({ tenantId: ctxA.tenantId, edtrId: paper!.id, hoursActive: '8.00', hoursIdle: '0.00' });
      await tx.insert(edtrReconciliations).values({
        tenantId: ctxA.tenantId, edtrId: log!.id, counterpartEdtrId: paper!.id, deltaHours: '0', tolerance: '0.25', status: 'approved', verifiedBy: ctxA.userId,
      });
      // An invoice due yesterday, with the customer's cash promise five days old.
      const [inv] = await tx.insert(invoices).values({
        tenantId: ctxA.tenantId, rentalId: rental!.id, invoiceType: 'weekly', amount: '5000.00', status: 'issued', dueDate: new Date(Date.now() - 86_400_000),
      }).returning();
      await tx.insert(payments).values({
        tenantId: ctxA.tenantId, invoiceId: inv!.id, method: 'cash', amount: '5000.00', status: 'pending', createdAt: new Date(Date.now() - 5 * 86_400_000),
      });
      return company!.id;
    });

    const r = await fleet.leakageReport(ctxA, { from, to: today, customerId: seeded });
    const amount = (key: string) => r.findings.find((f) => f.key === key)!.amountPhp;
    expect(amount('unbilled_hours')).toBe(8000);
    expect(amount('missing_logs')).toBe(9 * 8 * 1000);
    expect(amount('overdue')).toBe(5000);
    expect(amount('cash_pending')).toBe(5000);
    expect(r.findings[0]!.key).toBe('missing_logs');
    expect(r.summary.topActions[0]!.title).toBe('Days on site with no field log');
    expect(r.findings.find((f) => f.key === 'missing_logs')!.records[0]!.detail).toContain('9 days with no field log');
  });

  it('grades severity against what was invoiced, never "high" for a missed opportunity', () => {
    expect(severityOf(6000, 100_000, 'lost')).toBe('high');
    expect(severityOf(2000, 100_000, 'delayed')).toBe('medium');
    expect(severityOf(500, 100_000, 'lost')).toBe('low');
    expect(severityOf(90_000, 100_000, 'opportunity')).toBe('medium');
    expect(severityOf(0, 0, 'lost')).toBe('low');
  });

  it("counts a booking's days inside the period, never past today", () => {
    const start = new Date('2026-09-28T08:00:00+08:00');
    expect(daysInWindow(start, null, '2026-09-01', '2026-09-30', '2026-09-29')).toEqual(['2026-09-28', '2026-09-29']);
    expect(daysInWindow(start, new Date('2026-10-02T08:00:00+08:00'), '2026-10-01', '2026-10-31', '2026-10-05')).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('never shows one tenant another tenant\'s fleet', async () => {
    const [a, b] = await Promise.all([fleet.leakageReport(ctxA, {}), fleet.leakageReport(ctxB, {})]);
    const unit = await fleet.create(ctxA, {
      equipmentTypeId: typeIds[0]!,
      model: 'Leakage Isolation Unit',
      serialNo: `leakage-iso-${Date.now()}`,
      availabilityStatus: 'available',
    });
    const [aAfter, bAfter] = await Promise.all([fleet.leakageReport(ctxA, {}), fleet.leakageReport(ctxB, {})]);
    expect(aAfter.master.fleetTotal).toBeGreaterThan(a.master.fleetTotal);
    expect(bAfter.master.fleetTotal).toBe(b.master.fleetTotal);
    // Tenant B's utilization is its own units only.
    const utilB = await fleet.utilizationReport(ctxB, {});
    expect(utilB.fleet.some((f) => f.equipmentId === unit.id)).toBe(false);
  });

  it('narrows the fleet to the chosen equipment type', async () => {
    const all = await fleet.leakageReport(ctxA, {});
    const typed = await fleet.leakageReport(ctxA, { equipmentTypeId: typeIds[0]! });
    expect(typed.master.fleetTotal).toBeLessThanOrEqual(all.master.fleetTotal);
    expect(typed.filters.equipmentType).toEqual(expect.any(String));
    // Trucks cannot be tied to a type, so a filtered report says "no data" rather than a count.
    expect(typed.ledger.truckTrips).toBe(0);
  });

  it('returns a downloadable PDF', async () => {
    const res = await fleet.leakageReportPdf(ctxA, { from: '2026-09-01', to: '2026-09-30' });
    expect(res.filename).toBe('revenue-leakage-2026-09-01-to-2026-09-30.pdf');
    const doc = await PDFDocument.load(Buffer.from(res.contentBase64, 'base64'));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('rejects a reversed or over-long range', () => {
    expect(LeakageReportQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(false);
    expect(LeakageReportQuerySchema.safeParse({ from: '2025-01-01', to: '2026-09-01' }).success).toBe(false);
    expect(LeakageReportQuerySchema.safeParse({ customerId: 'not-a-uuid' }).success).toBe(false);
  });

  it('is gated by report:read on both routes', async () => {
    const reflector = new Reflector();
    expect(reflector.get(PERMISSION_KEY, FleetController.prototype.leakageReport)).toEqual(['report:read']);
    expect(reflector.get(PERMISSION_KEY, FleetController.prototype.leakageReportPdf)).toEqual(['report:read']);
    reflector.getAllAndOverride = () => ['report:read'];
    const req = { ctx: { tenantId: ctxA.tenantId, userId: ctxA.userId, role: 'timekeeper' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;
    expect(await new PermissionsGuard(reflector).canActivate(context)).toBe(false);
  });
});
