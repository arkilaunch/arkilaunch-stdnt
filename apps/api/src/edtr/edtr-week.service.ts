import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import {
  type Tx,
  addresses,
  auditLogs,
  customers,
  depositAccruals,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  invoiceLineItems,
  invoices,
  issueWeeklyInvoice,
  projectSites,
  rentalBillingWeeks,
  rentals,
  resolveDepositLedger,
  sendEmail,
  withTenantTx,
} from '@arkilaunch/db';
import {
  round2HalfUp,
  sumApproved,
  weekBillBlock,
  weekClosureBlock,
  type EdtrLineItemsInput,
  type EdtrWeekBillRequest,
  type EdtrWeekBillResponse,
  type EdtrWeekResponse,
  type OcrPayload,
  type RequestContext,
  manilaDate,
} from '@arkilaunch/shared';
import { BillingService } from '../billing/billing.service.js';
import { loadFieldLogs, num } from '../common/field-logs.js';
import { notifyBookingCustomer } from '../common/notify-customer.js';

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function assertMonday(weekStart: string) {
  const d = new Date(`${weekStart}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || Number.isNaN(d.getTime()) || d.getUTCDay() !== 1) {
    throw new BadRequestException({ error: 'week_start_not_monday' });
  }
}

// One unit, one Mon-Sun week of field logs, and the office's "Approve & bill" for it. Runs under the
// caller's tenant (RLS); the tenant always comes from the verified token, never the request (RFC-1).
@Injectable()
export class EdtrWeekService {
  constructor(private readonly billing: BillingService) {}

  week(ctx: RequestContext, rentalId: string, equipmentId: string, weekStart: string): Promise<EdtrWeekResponse> {
    assertMonday(weekStart);
    return withTenantTx(ctx, async (tx) => {
      const result = await this.load(tx, rentalId, equipmentId, weekStart);
      const weekEnd = addDays(weekStart, 6);
      const logs = await loadFieldLogs(tx, [rentalId], weekEnd);
      const labels = new Map(logs.units.map((unit) => [unit.equipmentId, `${unit.name} (SN ${unit.serialNo})`]));
      const [closed] = await tx.select({ closedAt: rentalBillingWeeks.closedAt, invoiceId: rentalBillingWeeks.invoiceId }).from(rentalBillingWeeks)
        .where(and(eq(rentalBillingWeeks.tenantId, ctx.tenantId), eq(rentalBillingWeeks.rentalId, rentalId), eq(rentalBillingWeeks.weekStart, weekStart))).limit(1);
      const [closedInvoice] = closed?.invoiceId ? await tx.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, closed.invoiceId)).limit(1) : [];
      const [reissueAccrual] = closedInvoice?.status === 'void' ? await tx.select({ id: depositAccruals.id }).from(depositAccruals)
        .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, depositAccruals.reconciliationId))
        .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
        .where(and(eq(depositAccruals.tenantId, ctx.tenantId), eq(depositAccruals.rentalId, rentalId), isNull(depositAccruals.invoiceId),
          gte(edtr.reportDate, weekStart), lte(edtr.reportDate, weekEnd))).limit(1) : [];
      return { ...result.week, closureDays: logs.days.filter((day) => day.date >= weekStart && day.date <= weekEnd)
        .map((day) => ({ equipmentId: day.equipmentId, label: labels.get(day.equipmentId) ?? day.equipmentId, day: day.date, status: day.status })),
        closedAt: closed?.closedAt.toISOString() ?? null,
        reissueAllowed: !!closed?.invoiceId && closedInvoice?.status === 'void' && !!reissueAccrual };
    });
  }

  async bill(
    ctx: RequestContext,
    rentalId: string,
    equipmentId: string,
    weekStart: string,
    body: EdtrWeekBillRequest,
  ): Promise<EdtrWeekBillResponse> {
    assertMonday(weekStart);
    const issued = await withTenantTx(ctx, async (tx) => {
      let { week } = await this.load(tx, rentalId, equipmentId, weekStart);
      let block = weekBillBlock({ days: week.days, billableHours: week.totals.billable, request: body });
      if (block) {
        throw block.error === 'week_summary_mismatch' ? new UnprocessableEntityException(block) : new ConflictException(block);
      }
      const weekEnd = addDays(weekStart, 6);
      const [rental] = await tx.select().from(rentals)
        .where(and(eq(rentals.tenantId, ctx.tenantId), eq(rentals.id, rentalId))).for('update').limit(1);
      if (!rental) throw new NotFoundException({ error: 'rental_not_found' });
      week = (await this.load(tx, rentalId, equipmentId, weekStart)).week;
      block = weekBillBlock({ days: week.days, billableHours: week.totals.billable, request: body });
      if (block) throw block.error === 'week_summary_mismatch' ? new UnprocessableEntityException(block) : new ConflictException(block);
      const [closed] = await tx.select().from(rentalBillingWeeks)
        .where(and(eq(rentalBillingWeeks.tenantId, ctx.tenantId), eq(rentalBillingWeeks.rentalId, rentalId), eq(rentalBillingWeeks.weekStart, weekStart))).limit(1);
      if (closed) {
        if (!closed.invoiceId || !body.correctionReason) throw new ConflictException({ error: 'week_already_closed', invoiceId: closed.invoiceId });
        const live = await tx.select({ id: invoices.id }).from(invoices)
          .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.rentalId, rentalId), eq(invoices.billingWeekStart, weekStart),
            inArray(invoices.invoiceType, ['weekly', 'weekly_correction']), ne(invoices.status, 'void'))).limit(1);
        if (live.length) throw new ConflictException({ error: 'week_already_invoiced', invoiceId: live[0]!.id });
        const reissueRows = await tx.select({ id: depositAccruals.id }).from(depositAccruals)
          .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, depositAccruals.reconciliationId))
          .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
          .where(and(eq(depositAccruals.tenantId, ctx.tenantId), eq(depositAccruals.rentalId, rentalId),
            isNull(depositAccruals.invoiceId), gte(edtr.reportDate, weekStart), lte(edtr.reportDate, weekEnd)));
        if (!reissueRows.length) throw new ConflictException({ error: 'week_has_no_unbilled_correction' });
        const reissued = await issueWeeklyInvoice(tx, { tenantId: ctx.tenantId, rentalId,
          accrualIds: reissueRows.map((row) => row.id), weekStart, invoiceType: 'weekly_correction' });
        await tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'APPROVE',
          entity: 'edtr_week_reissued', entityId: reissued?.invoiceId ?? rentalId, reason: body.correctionReason });
        return reissued;
      }
      const logs = await loadFieldLogs(tx, [rentalId], weekEnd);
      const scheduled = logs.days.filter((day) => day.date >= weekStart && day.date <= weekEnd);
      const noWork = body.noWorkDays ?? [];
      const closure = weekClosureBlock({ today: manilaDate(new Date()), weekEnd, days: scheduled.map((day) => ({ equipmentId: day.equipmentId, date: day.date, status: day.status })), noWorkDays: noWork });
      if (closure) throw closure.error === 'invalid_no_work_confirmation' ? new UnprocessableEntityException(closure) : new ConflictException(closure);
      const [site] = await tx.select({ line1: addresses.line1, barangay: addresses.barangay, city: addresses.city, province: addresses.province })
        .from(projectSites).innerJoin(addresses, eq(addresses.id, projectSites.addressId))
        .where(and(eq(projectSites.tenantId, ctx.tenantId), eq(projectSites.id, rental.projectSiteId))).limit(1);
      const [company] = await tx.select({ companyName: customers.companyName, tin: customers.tin, billingAddress: customers.billingAddress })
        .from(customers).where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.id, rental.customerId))).limit(1);
      if (!site || !company) throw new ConflictException({ error: 'billing_header_missing' });
      let deductedWeek = await tx.select({ equipmentId: edtr.equipmentId, amount: invoiceLineItems.amount, hours: invoiceLineItems.quantity, rate: invoiceLineItems.unitPrice })
        .from(invoiceLineItems).innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
        .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, invoiceLineItems.reconciliationId))
        .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
        .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.rentalId, rentalId), eq(invoices.invoiceType, 'deposit_deduction'), ne(invoices.status, 'void'), gte(edtr.reportDate, weekStart), lte(edtr.reportDate, weekEnd)));
      let accruedWeek = await tx.select({ id: depositAccruals.id, equipmentId: edtr.equipmentId, amount: depositAccruals.amount, hours: depositAccruals.hours, rate: depositAccruals.unitPrice, invoiceId: depositAccruals.invoiceId })
        .from(depositAccruals).innerJoin(edtrReconciliations, eq(edtrReconciliations.id, depositAccruals.reconciliationId))
        .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
        .where(and(eq(depositAccruals.tenantId, ctx.tenantId), eq(depositAccruals.rentalId, rentalId), gte(edtr.reportDate, weekStart), lte(edtr.reportDate, weekEnd)));
      if (accruedWeek.some((row) => row.invoiceId)) throw new ConflictException({ error: 'week_already_invoiced' });
      const result = await issueWeeklyInvoice(tx, { tenantId: ctx.tenantId, rentalId, accrualIds: accruedWeek.map((row) => row.id), weekStart });
      if (rental.depositMode !== 'per_machine' && accruedWeek.length) {
        deductedWeek = await tx.select({ equipmentId: edtr.equipmentId, amount: invoiceLineItems.amount, hours: invoiceLineItems.quantity, rate: invoiceLineItems.unitPrice })
          .from(invoiceLineItems).innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
          .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, invoiceLineItems.reconciliationId))
          .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
          .where(and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.rentalId, rentalId), eq(invoices.invoiceType, 'deposit_deduction'), ne(invoices.status, 'void'), gte(edtr.reportDate, weekStart), lte(edtr.reportDate, weekEnd)));
        accruedWeek = await tx.select({ id: depositAccruals.id, equipmentId: edtr.equipmentId, amount: depositAccruals.amount, hours: depositAccruals.hours, rate: depositAccruals.unitPrice, invoiceId: depositAccruals.invoiceId })
          .from(depositAccruals).innerJoin(edtrReconciliations, eq(edtrReconciliations.id, depositAccruals.reconciliationId))
          .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
          .where(and(eq(depositAccruals.tenantId, ctx.tenantId), eq(depositAccruals.rentalId, rentalId), gte(edtr.reportDate, weekStart), lte(edtr.reportDate, weekEnd)));
      }
      const usageLines = logs.units.filter((unit) => scheduled.some((day) => day.equipmentId === unit.equipmentId))
        .sort((a, b) => a.name.localeCompare(b.name) || a.serialNo.localeCompare(b.serialNo))
        .map((unit) => {
        const deducted = deductedWeek.filter((row) => row.equipmentId === unit.equipmentId);
        const accrued = accruedWeek.filter((row) => row.equipmentId === unit.equipmentId);
        const all = [...deducted, ...accrued];
        const hours = round2HalfUp(all.reduce((sum, row) => sum + Number(row.hours), 0));
        const depositApplied = round2HalfUp(deducted.reduce((sum, row) => sum + Number(row.amount), 0));
        const net = round2HalfUp(accrued.reduce((sum, row) => sum + Number(row.amount), 0));
        const rates = [...new Set(all.map((row) => Number(row.rate)))];
        if (rates.length > 1) throw new ConflictException({ error: 'weekly_rate_mismatch', equipmentId: unit.equipmentId });
        return { equipmentId: unit.equipmentId, label: unit.name, serialNo: unit.serialNo, hours, unitPrice: rates[0] ?? 0,
          gross: round2HalfUp(depositApplied + net), depositApplied, net };
      });
      const [snapshot] = await tx.insert(rentalBillingWeeks).values({ tenantId: ctx.tenantId, rentalId, weekStart,
        noWorkDays: noWork, usageLines, billToSnapshot: company,
        siteSnapshot: { projectSiteId: rental.projectSiteId, display: [site.line1, site.barangay, site.city, site.province].filter(Boolean).join(', ') },
        closedBy: ctx.userId }).returning();
      if (!snapshot) throw new Error('billing week snapshot insert returned no row');
      if (result) await tx.update(rentalBillingWeeks).set({ invoiceId: result.invoiceId }).where(eq(rentalBillingWeeks.id, snapshot.id));

      // Every billed week tells the customer what it used, even when the deposit paid for all of it.
      const fromDeposit = await tx
        .select({ invoiceId: invoices.id, amount: invoiceLineItems.amount })
        .from(invoiceLineItems)
        .innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
        .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, invoiceLineItems.reconciliationId))
        .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
        .where(
          and(
            eq(invoices.rentalId, rentalId),
            eq(invoices.invoiceType, 'deposit_deduction'),
            ne(invoices.status, 'void'),
            eq(edtr.equipmentId, equipmentId),
            gte(edtr.reportDate, weekStart),
            lte(edtr.reportDate, weekEnd),
          ),
        )
        .orderBy(desc(invoices.createdAt));
      if (fromDeposit.length > 0) {
        const ledger = await resolveDepositLedger(tx, rentalId, ctx.tenantId);
        await notifyBookingCustomer(tx, ctx.tenantId, rentalId, 'weekly_statement', {
          // The email reads the booking through this invoice; the deposit deduction is the week's record.
          invoice_id: fromDeposit[0]!.invoiceId,
          booking_code: week.bookingCode,
          week_start: weekStart,
          hours: week.totals.billable,
          from_deposit_php: round2HalfUp(fromDeposit.reduce((sum, row) => sum + Number(row.amount), 0)),
          deposit_left_php: round2HalfUp(Math.max(0, ledger.depositRequired - ledger.totalDeducted)),
          due_php: result?.amount ?? 0,
        });
      }
      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'APPROVE',
        entity: 'edtr_week_billed',
        entityId: result?.invoiceId ?? rentalId,
        reason: JSON.stringify({
          rentalId,
          equipmentId,
          weekStart,
          weekBillableHours: body.weekBillableHours,
          sheetBillableHours: body.sheetBillableHours,
          mismatchNote: body.mismatchNote ?? null,
        }),
      });
      return result;
    });

    // After the commit: a failed email never un-bills the week, and the office can resend the SOA.
    if (issued?.mail) {
      const { to, subject, text, html } = issued.mail;
      await sendEmail(to, subject, text, html).catch((err) => console.error('edtr-week: invoice email failed', err));
    }
    const soaEmailedTo = await this.billing
      .emailStatement(ctx, rentalId)
      .then((r) => r.sentTo)
      .catch((err) => {
        console.error('edtr-week: SOA email failed', err);
        return null;
      });
    return { invoiceId: issued?.invoiceId ?? null, amountPhp: issued?.amount ?? 0, soaEmailedTo };
  }

  private async load(tx: Tx, rentalId: string, equipmentId: string, weekStart: string) {
    const weekEnd = addDays(weekStart, 6);
    // The whole week, not only up to today: a logged day must hold the bill even if its date is ahead.
    const logs = await loadFieldLogs(tx, [rentalId], weekEnd);
    const unit = logs.units.find((u) => u.equipmentId === equipmentId);
    if (!unit) throw new NotFoundException({ error: 'unit_not_on_rental' });

    // Only days inside the unit's span.
    const days = logs.days.filter((d) => d.equipmentId === equipmentId && d.date >= weekStart && d.date <= weekEnd);
    const ids = days.map((d) => d.edtrId).filter((id): id is string => !!id);
    const [items, rows] = ids.length
      ? await Promise.all([
          tx.select().from(edtrLineItems).where(inArray(edtrLineItems.edtrId, ids)),
          tx.select({ id: edtr.id, ocrPayload: edtr.ocrPayload }).from(edtr).where(inArray(edtr.id, ids)),
        ])
      : [[], []];
    const itemByEdtr = new Map(items.map((i) => [i.edtrId, i]));
    const summary = rows.map((r) => (r.ocrPayload as OcrPayload | null)?.week_summary).find((s) => s && (s.billable !== null || s.not_billed !== null));

    const accruals = await tx
      .select({ id: depositAccruals.id, invoiceId: depositAccruals.invoiceId, amount: depositAccruals.amount, billedAt: invoices.createdAt, invoiceStatus: invoices.status })
      .from(depositAccruals)
      .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, depositAccruals.reconciliationId))
      .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
      .leftJoin(invoices, eq(invoices.id, depositAccruals.invoiceId))
      .where(
        and(
          eq(depositAccruals.rentalId, rentalId),
          eq(edtr.equipmentId, equipmentId),
          gte(edtr.reportDate, weekStart),
          lte(edtr.reportDate, weekEnd),
        ),
      );
    const unbilled = accruals.filter((a) => a.invoiceId === null);
    const billedAt = accruals.filter((a) => a.invoiceStatus !== 'void').map((a) => a.billedAt).filter((t): t is Date => !!t).sort((a, b) => b.getTime() - a.getTime())[0];

    const undecided = days.some((d) => d.status === 'pending' || d.status === 'needs_correction');
    const billState = undecided ? 'open' : unbilled.length > 0 ? 'ready' : accruals.length > 0 ? 'billed' : 'covered';

    const week: EdtrWeekResponse = {
      rentalId,
      equipmentId,
      weekStart,
      unitName: unit.name,
      bookingCode: unit.bookingCode,
      days: days.map((d) => {
        const item = d.edtrId ? itemByEdtr.get(d.edtrId) : undefined;
        const reading: EdtrLineItemsInput | null = item
          ? {
              hoursActive: Number(item.hoursActive),
              hoursIdle: num(item.hoursIdle) ?? 0,
              hoursTotal: num(item.hoursTotal),
              hoursBreakdown: num(item.hoursBreakdown),
              hoursWeather: num(item.hoursWeather),
              hoursOtherDowntime: num(item.hoursOtherDowntime),
              downtimeNote: item.downtimeNote,
              hourMeterStart: num(item.hourMeterStart),
              hourMeterEnd: num(item.hourMeterEnd),
            }
          : null;
        return { date: d.date, status: d.status, edtrId: d.edtrId, reading, hours: d.hours, flags: d.flags };
      }),
      totals: sumApproved(days.flatMap((d) => (d.hours ? [d.hours] : []))),
      sheetSummary: summary ? { billable: summary.billable, notBilled: summary.not_billed } : null,
      billState,
      unbilledPhp: round2HalfUp(unbilled.reduce((s, a) => s + Number(a.amount), 0)),
      lastBilledAt: billedAt?.toISOString() ?? null,
    };
    return { week, unbilledAccrualIds: unbilled.map((a) => a.id) };
  }
}
