import { and, gte, inArray, lt, lte } from 'drizzle-orm';
import {
  bookingChangeRequests,
  couponRedemptions,
  customers,
  depositAccruals,
  edtr,
  edtrLineItems,
  edtrReconciliations,
  equipment,
  equipmentAssignments,
  equipmentTypes,
  invoiceLineItems,
  invoices,
  payments,
  projectSites,
  quotations,
  rateCards,
  rentals,
  truckRequests,
  withTenantTx,
} from '@arkilaunch/db';
import type {
  LeakageFinding,
  LeakageKind,
  LeakageRecord,
  LeakageReport,
  LeakageReportQuery,
  LeakageSeverity,
  RequestContext,
  UtilizationReportResponse,
} from '@arkilaunch/shared';
import { addDaysIso, manilaDate, round2HalfUp } from '@arkilaunch/shared';

const DAY_MS = 86_400_000;
// ponytail: a working day is 8 billable hours when a booking carries no booked hours; tenant setting if it varies.
export const WORKDAY_HOURS = 8;
// Cash a customer chose but nobody recorded within this many days is chased.
const CASH_GRACE_DAYS = 3;
const sum = (xs: number[]) => round2HalfUp(xs.reduce((a, b) => a + b, 0));
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x]: (acc[x] ?? 0) + 1 }), {});
const pct = (part: number, whole: number) => (whole > 0 ? round2HalfUp((part / whole) * 100) : null);
const php = (n: number) => `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// High when the leak is at least 5% of what was invoiced (or PHP 50k with nothing invoiced), medium from 1%.
// Missed opportunity is never "high": nobody owes it.
export function severityOf(amountPhp: number, invoiced: number, kind: LeakageKind): LeakageSeverity {
  if (amountPhp <= 0) return 'low';
  const base = invoiced > 0 ? amountPhp / invoiced : amountPhp / 1_000_000;
  const level: LeakageSeverity = base >= 0.05 ? 'high' : base >= 0.01 ? 'medium' : 'low';
  return kind === 'opportunity' && level === 'high' ? 'medium' : level;
}

// Manila days of [start, end] inside [from, to] (inclusive ISO days), never past today.
export function daysInWindow(start: Date, end: Date | null, from: string, to: string, today: string): string[] {
  const first = [manilaDate(start), from].sort().at(-1)!;
  const last = [end ? manilaDate(end) : today, to, today].sort()[0]!;
  const days: string[] = [];
  for (let d = first; d <= last; d = addDaysIso(d, 1)) days.push(d);
  return days;
}

const top = (records: LeakageRecord[]) => [...records].sort((a, b) => b.amountPhp - a.amountPhp).slice(0, 5);

// The tenant's own records turned into leaks with a peso figure, ranked. Filters: customer and equipment type narrow
// everything tied to a booking; truck trips have no customer record, so either filter leaves them out.
export async function buildLeakageReport(
  ctx: RequestContext,
  q: { from: string; to: string } & Pick<LeakageReportQuery, 'customerId' | 'equipmentTypeId'>,
  utilization: UtilizationReportResponse,
): Promise<LeakageReport> {
  const start = new Date(`${q.from}T00:00:00+08:00`);
  const end = new Date(new Date(`${q.to}T00:00:00+08:00`).getTime() + DAY_MS);
  const now = new Date();
  const today = manilaDate(now);
  const inPeriod = (d: Date) => d >= start && d < end;

  return withTenantTx(ctx, async (tx) => {
    const [typeRows, fleetRows, customerRows, siteRows, rateRows] = await Promise.all([
      tx.select().from(equipmentTypes),
      tx.select().from(equipment),
      tx.select().from(customers),
      tx.select({ id: projectSites.id }).from(projectSites),
      tx.select().from(rateCards),
    ]);
    const fleet = q.equipmentTypeId ? fleetRows.filter((e) => e.equipmentTypeId === q.equipmentTypeId) : fleetRows;
    const fleetIds = new Set(fleet.map((e) => e.id));
    const unitById = new Map(fleetRows.map((e) => [e.id, e]));
    const unitName = (id: string) => {
      const u = unitById.get(id);
      return u ? `${u.model} (${u.serialNo})` : 'Unknown unit';
    };
    const customerName = new Map(customerRows.map((c) => [c.id, c.companyName]));

    // Hourly rate on a day: the unit's own card, else its category's, in force that day; 0 when none (shown as such).
    const rateFor = (equipmentId: string, day: string) => {
      const at = new Date(`${day}T12:00:00+08:00`);
      const typeId = unitById.get(equipmentId)?.equipmentTypeId;
      const live = rateRows.filter((r) => r.effectiveFrom <= at && (r.effectiveTo === null || r.effectiveTo > at));
      const card = live.find((r) => r.equipmentId === equipmentId) ?? live.find((r) => r.equipmentId === null && r.equipmentTypeId === typeId);
      return card ? Number(card.rateValue) : 0;
    };

    const assignmentRows = (await tx.select().from(equipmentAssignments)).filter((a) => fleetIds.has(a.equipmentId));
    let rentalRows = await tx.select().from(rentals);
    if (q.customerId) rentalRows = rentalRows.filter((r) => r.customerId === q.customerId);
    if (q.equipmentTypeId) {
      const typed = new Set(assignmentRows.map((a) => a.rentalId));
      rentalRows = rentalRows.filter((r) => typed.has(r.id));
    }
    const rentalIds = new Set(rentalRows.map((r) => r.id));
    const rentalById = new Map(rentalRows.map((r) => [r.id, r]));
    const scoped = q.customerId || q.equipmentTypeId;
    const inScope = (rentalId: string | null) => (rentalId ? rentalIds.has(rentalId) : !scoped);
    const bookingOf = (rentalId: string) => {
      const r = rentalById.get(rentalId);
      return r ? `${r.code ?? 'Booking'} · ${customerName.get(r.customerId) ?? 'Unknown customer'}` : 'Booking';
    };

    const periodBookings = rentalRows.filter((r) => inPeriod(r.createdAt));
    const assignments = assignmentRows.filter((a) => rentalIds.has(a.rentalId) && a.status !== 'cancelled');
    const periodAssignments = assignments.filter((a) => a.start < end && (a.end === null || a.end >= start));

    const invoiceRows = (
      await tx.select().from(invoices).where(and(gte(invoices.createdAt, start), lt(invoices.createdAt, end)))
    ).filter((i) => i.status !== 'void' && inScope(i.rentalId));
    // Receivables are as of today: every unpaid invoice up to the period's end, however old.
    const openRows = (await tx.select().from(invoices).where(lt(invoices.createdAt, end))).filter(
      (i) => i.status === 'issued' && inScope(i.rentalId),
    );
    const invoiceIds = invoiceRows.map((i) => i.id);
    const openIds = openRows.map((i) => i.id);
    const [paymentRows, openPayments, redemptions] = await Promise.all([
      invoiceIds.length ? tx.select().from(payments).where(inArray(payments.invoiceId, invoiceIds)) : [],
      openIds.length ? tx.select().from(payments).where(inArray(payments.invoiceId, openIds)) : [],
      invoiceIds.length ? tx.select().from(couponRedemptions).where(inArray(couponRedemptions.invoiceId, invoiceIds)) : [],
    ]);
    const paid = paymentRows.filter((p) => p.status === 'paid');

    const edtrRows = (
      await tx.select().from(edtr).where(and(gte(edtr.reportDate, q.from), lte(edtr.reportDate, q.to)))
    ).filter((e) => rentalIds.has(e.rentalId) && fleetIds.has(e.equipmentId));
    const edtrIds = edtrRows.map((e) => e.id);
    const [edtrLines, reconRows] = edtrIds.length
      ? await Promise.all([
          tx.select().from(edtrLineItems).where(inArray(edtrLineItems.edtrId, edtrIds)),
          tx.select().from(edtrReconciliations).where(inArray(edtrReconciliations.edtrId, edtrIds)),
        ])
      : [[], []];
    const reconIds = reconRows.map((r) => r.id);
    const [billedLines, accruedRecons] = reconIds.length
      ? await Promise.all([
          tx.select({ id: invoiceLineItems.reconciliationId }).from(invoiceLineItems).where(inArray(invoiceLineItems.reconciliationId, reconIds)),
          tx.select({ id: depositAccruals.reconciliationId }).from(depositAccruals).where(inArray(depositAccruals.reconciliationId, reconIds)),
        ])
      : [[], []];
    const billedRecon = new Set([...billedLines, ...accruedRecons].map((r) => r.id));
    const hoursOf = (edtrId: string) => Number(edtrLines.find((l) => l.edtrId === edtrId)?.hoursActive ?? 0);
    const edtrById = new Map(edtrRows.map((e) => [e.id, e]));

    const accrualRows = (
      await tx.select().from(depositAccruals).where(and(gte(depositAccruals.createdAt, start), lt(depositAccruals.createdAt, end)))
    ).filter((a) => rentalIds.has(a.rentalId));
    const quoteRows = (
      await tx.select().from(quotations).where(and(gte(quotations.createdAt, start), lt(quotations.createdAt, end)))
    ).filter((x) => (q.customerId ? x.customerId === q.customerId : true) && (!q.equipmentTypeId || inScope(x.rentalId)));
    const rootQuotes = quoteRows.filter((x) => x.parentQuotationId === null);
    const extensions = (await tx.select().from(bookingChangeRequests)).filter(
      (c) => c.kind === 'extend' && c.status === 'approved' && rentalIds.has(c.rentalId),
    );
    const tripRows = scoped
      ? []
      : await tx.select().from(truckRequests).where(and(gte(truckRequests.scheduledFor, start), lt(truckRequests.scheduledFor, end)));

    const invoiced = sum(invoiceRows.map((i) => Number(i.amount)));
    const collected = sum(paid.map((p) => Number(p.amount)));
    const invoiceAt = new Map(invoiceRows.map((i) => [i.id, i.createdAt.getTime()]));
    const daysToPay = paid.map((p) => (p.createdAt.getTime() - (invoiceAt.get(p.invoiceId) ?? p.createdAt.getTime())) / DAY_MS);
    const util = utilization.fleet.filter((f) => fleetIds.has(f.equipmentId));
    const periodDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));

    const finding = (
      f: Omit<LeakageFinding, 'severity' | 'amountPhp' | 'count' | 'records'> & { records: LeakageRecord[] },
    ): LeakageFinding => {
      const amountPhp = sum(f.records.map((r) => r.amountPhp));
      return { ...f, amountPhp, count: f.records.length, severity: severityOf(amountPhp, invoiced, f.kind), records: top(f.records) };
    };

    // 1. Approved hours that never reached an invoice or a deposit deduction.
    // A double-entry pair bills on one side only; the other side is not a leak.
    const reconByEdtr = new Map(reconRows.map((r) => [r.edtrId, r]));
    const pairBilled = (r: (typeof reconRows)[number]) => {
      const other = r.counterpartEdtrId ? reconByEdtr.get(r.counterpartEdtrId) : undefined;
      return !!other && billedRecon.has(other.id);
    };
    const unbilled = reconRows
      .filter((r) => r.status === 'approved' && !billedRecon.has(r.id) && !pairBilled(r))
      .flatMap((r) => {
        const e = edtrById.get(r.edtrId);
        if (!e) return [];
        const hours = hoursOf(e.id);
        return [{ label: `${bookingOf(e.rentalId)} · ${unitName(e.equipmentId)}`, detail: `${e.reportDate}: ${hours} h approved, not billed`, amountPhp: round2HalfUp(hours * rateFor(e.equipmentId, e.reportDate)) }];
      });

    // 2. Days a machine was out on a booking with no field log at all: hours worked that nobody can bill.
    const logged = new Set(edtrRows.map((e) => `${e.equipmentId}|${e.reportDate}`));
    const missing = periodAssignments
      .filter((a) => a.status === 'active' || a.status === 'completed')
      .flatMap((a) => {
        const days = daysInWindow(a.start, a.end, q.from, q.to, today).filter((d) => !logged.has(`${a.equipmentId}|${d}`));
        if (!days.length) return [];
        const perDay = a.bookedHours ? Math.min(24, Number(a.bookedHours) / Math.max(1, daysInWindow(a.start, a.end, manilaDate(a.start), a.end ? manilaDate(a.end) : today, today).length)) : WORKDAY_HOURS;
        const amount = sum(days.map((d) => perDay * rateFor(a.equipmentId, d)));
        return [{ label: `${bookingOf(a.rentalId)} · ${unitName(a.equipmentId)}`, detail: `${days.length} day${days.length === 1 ? '' : 's'} with no field log (${days[0]}${days.length > 1 ? ` to ${days.at(-1)}` : ''})`, amountPhp: amount }];
      });

    // 3. Machines still on site past their end date with no approved extension: free rental days.
    const overstay = assignments
      .filter((a) => a.status === 'active' && a.end !== null && a.end < now)
      .filter((a) => !extensions.some((x) => (x.assignmentId === a.id || x.assignmentId === null) && x.rentalId === a.rentalId && x.requestedEnd !== null && x.requestedEnd >= now))
      .map((a) => {
        const days = Math.max(1, Math.floor((now.getTime() - a.end!.getTime()) / DAY_MS));
        return { label: `${bookingOf(a.rentalId)} · ${unitName(a.equipmentId)}`, detail: `${days} day${days === 1 ? '' : 's'} past the end date (${manilaDate(a.end!)}), no extension`, amountPhp: round2HalfUp(days * WORKDAY_HOURS * rateFor(a.equipmentId, today)) };
      });

    // 4. Unpaid invoices past their due date, by age.
    const ageBucket = (days: number) => (days > 90 ? 'over 90 days' : days > 60 ? '61-90 days' : days > 30 ? '31-60 days' : '1-30 days');
    const overdue = openRows
      .filter((i) => i.dueDate < now)
      .map((i) => {
        const days = Math.floor((now.getTime() - i.dueDate.getTime()) / DAY_MS);
        const who = i.rentalId ? bookingOf(i.rentalId) : i.truckRequestId ? 'Truck trip' : 'Invoice';
        return { label: `${who} · ${i.invoiceType} invoice`, detail: `${days} days overdue (${ageBucket(days)})`, amountPhp: Number(i.amount) };
      });

    // 5. The customer chose "pay cash at the office" and nobody recorded the money.
    const cashCutoff = now.getTime() - CASH_GRACE_DAYS * DAY_MS;
    const cash = openPayments
      .filter((p) => p.method === 'cash' && p.status === 'pending' && p.createdAt.getTime() < cashCutoff)
      .map((p) => {
        const inv = openRows.find((i) => i.id === p.invoiceId);
        return { label: inv?.rentalId ? bookingOf(inv.rentalId) : 'Truck trip', detail: `cash promised ${manilaDate(p.createdAt)}, not recorded`, amountPhp: Number(p.amount) };
      });

    // 6. Hours held in review or dispute: billable once someone decides.
    const disputedIds = new Set([
      ...edtrRows.filter((e) => e.status === 'review').map((e) => e.id),
      ...reconRows.filter((r) => r.status === 'discrepancy').map((r) => r.edtrId),
    ]);
    // Both logs of a disputed machine-day are in review; the day counts once.
    const disputedDays = new Set<string>();
    const disputed = [...disputedIds].flatMap((id) => {
      const e = edtrById.get(id);
      if (!e) return [];
      const day = `${e.equipmentId}|${e.reportDate}`;
      if (disputedDays.has(day)) return [];
      disputedDays.add(day);
      const hours = hoursOf(id);
      return [{ label: `${bookingOf(e.rentalId)} · ${unitName(e.equipmentId)}`, detail: `${e.reportDate}: ${hours} h waiting for a decision`, amountPhp: round2HalfUp(hours * rateFor(e.equipmentId, e.reportDate)) }];
    });

    // 7. Sheets the reader could not read at all: a day's hours with no number on them yet.
    const unreadable = edtrRows
      .filter((e) => e.status === 'hard_failed')
      .map((e) => ({ label: `${bookingOf(e.rentalId)} · ${unitName(e.equipmentId)}`, detail: `${e.reportDate}: sheet unreadable, retype it`, amountPhp: round2HalfUp(WORKDAY_HOURS * rateFor(e.equipmentId, e.reportDate)) }));

    // 8. Discounts given away: coupons, and truck trips agreed below their own routed price.
    const discounts = [
      ...redemptions.map((r) => ({ label: `Coupon on ${customerName.get(r.customerId) ?? 'a customer'}`, detail: `redeemed ${manilaDate(r.createdAt)}`, amountPhp: Number(r.discountPhp) })),
      ...tripRows
        .filter((t) => t.agreedPricePhp !== null && Number(t.agreedPricePhp) < (t.price as { totalPhp: number }).totalPhp && t.status !== 'cancelled' && t.status !== 'expired')
        .map((t) => {
          const list = (t.price as { totalPhp: number }).totalPhp;
          return { label: `Truck ${t.code ?? ''}`.trim(), detail: `agreed ${php(Number(t.agreedPricePhp))} vs routed ${php(list)}`, amountPhp: round2HalfUp(list - Number(t.agreedPricePhp)) };
        }),
    ];

    // 9. Units that earned nothing all period. Not tied to any customer, so a customer filter leaves them out.
    const idle = (q.customerId ? [] : util)
      .filter((f) => f.utilizationPct === 0 && unitById.get(f.equipmentId)?.availabilityStatus !== 'maintenance')
      .map((f) => ({ label: unitName(f.equipmentId), detail: `idle all ${periodDays} days`, amountPhp: round2HalfUp(periodDays * WORKDAY_HOURS * rateFor(f.equipmentId, q.to)) }));

    const findings = [
      finding({ key: 'unbilled_hours', title: 'Approved hours never billed', kind: 'lost', records: unbilled,
        whyItMatters: 'These hours were checked and approved, so the customer already agreed to them, but no invoice or deposit deduction carries them. Unbilled work is the purest leak: the cost was spent and nothing comes back.',
        whatToDo: 'Open each day in Field logs and bill it (deduct from the deposit or add it to the weekly invoice) before the period closes.',
        howMeasured: 'Approved reconciliations with no invoice line and no deposit deduction, times the hourly rate in force that day.' }),
      finding({ key: 'missing_logs', title: 'Days on site with no field log', kind: 'lost', records: missing,
        whyItMatters: 'A machine on site works, but without a signed daily time record there is nothing to bill and nothing to show the customer. Missing paper is the most common way rental hours disappear.',
        whatToDo: "Ask the site's timekeeper for the missing sheets (or print blanks from Field logs) and record them; follow up the same week while the crew still remembers.",
        howMeasured: 'Each day a unit was out on a booking in the period with no field log, times its booked hours per day (8 h if none), times the hourly rate.' }),
      finding({ key: 'overstay', title: 'Machines kept past the end date', kind: 'lost', records: overstay,
        whyItMatters: 'A unit still on site after its booking ended is working for free and is not available for the next customer. Every extra day is a full day of rent the yard is giving away.',
        whatToDo: 'Call the customer today: either approve an extension (so the days are billed) or schedule the pull-out.',
        howMeasured: 'Assignments still active after their end date with no approved extension, days overdue times 8 h times the current rate (as of today).' }),
      finding({ key: 'overdue', title: 'Invoices past due', kind: 'delayed', records: overdue,
        whyItMatters: 'Billed but not collected. The older a receivable gets, the less likely it is paid in full; past 90 days it is often written off, and the yard is financing the customer meanwhile.',
        whatToDo: 'Chase the oldest and largest first; hold new bookings for customers with invoices over 60 days.',
        howMeasured: 'Issued, unpaid invoices whose due date has passed, as of today, grouped by age.' }),
      finding({ key: 'cash_pending', title: 'Cash promised, not recorded', kind: 'delayed', records: cash,
        whyItMatters: `The customer chose to pay cash at the office more than ${CASH_GRACE_DAYS} days ago and no payment was recorded. Either the money has not come in, or it came in and was never logged, which is how cash goes missing.`,
        whatToDo: 'Check the cash box and receipts. Record the payment with its OR number if it arrived, otherwise call the customer.',
        howMeasured: `Pending cash payments older than ${CASH_GRACE_DAYS} days on invoices that are still unpaid.` }),
      finding({ key: 'disputed_hours', title: 'Hours stuck in review or dispute', kind: 'delayed', records: disputed,
        whyItMatters: 'These days cannot be billed until someone decides which record is right. Disputes left open get harder to settle and end up discounted.',
        whatToDo: 'Settle them in Field logs: compare the photo with the typed log and approve the hours you can defend.',
        howMeasured: 'Field logs in review or with a discrepancy, their recorded hours times the hourly rate.' }),
      finding({ key: 'unreadable', title: 'Unreadable time sheets', kind: 'delayed', records: unreadable,
        whyItMatters: 'The sheet photo could not be read, so the day has no hours on it yet. If nobody retypes it, the day is never billed.',
        whatToDo: 'Retype the hours from the photo, or ask for a clearer photo of the sheet.',
        howMeasured: 'Field logs that failed to read, at 8 h times the hourly rate per day.' }),
      finding({ key: 'discounts', title: 'Discounts given', kind: 'lost', records: discounts,
        whyItMatters: 'Discounts are a choice, but they come straight out of margin. Watch whether they win repeat business or just lower the price for customers who would have paid in full.',
        whatToDo: 'Review who gets coupons and truck prices below the routed price; keep discounts for repeat or large customers.',
        howMeasured: 'Coupon amounts redeemed in the period, plus truck trips agreed below their own routed price.' }),
      finding({ key: 'idle_fleet', title: 'Machines that earned nothing', kind: 'opportunity', records: idle,
        whyItMatters: 'Not money owed, but money missed: an idle machine still costs insurance, storage and depreciation. Units idle for a whole period are candidates to market harder, move to a busier area, or sell.',
        whatToDo: 'Promote idle units (price, storefront photo), offer them to current customers, or plan to sell the slowest ones.',
        howMeasured: 'Units with zero utilization in the period (not in maintenance), period days times 8 h times the hourly rate.' }),
    // Money lost or owed first, largest first; missed opportunity after it, whatever its size, since nobody owes it.
    ].sort((a, b) => Number(a.kind === 'opportunity') - Number(b.kind === 'opportunity') || b.amountPhp - a.amountPhp);

    const by = (kind: LeakageKind) => sum(findings.filter((f) => f.kind === kind).map((f) => f.amountPhp));
    const atRisk = { lost: by('lost'), delayed: by('delayed'), opportunity: by('opportunity'), total: 0 };
    atRisk.total = sum([atRisk.lost, atRisk.delayed, atRisk.opportunity]);

    return {
      period: { from: q.from, to: q.to },
      filters: {
        customer: q.customerId ? (customerRows.find((c) => c.id === q.customerId)?.companyName ?? null) : null,
        equipmentType: q.equipmentTypeId ? (typeRows.find((t) => t.id === q.equipmentTypeId)?.name ?? null) : null,
      },
      generatedAt: now.toISOString(),
      summary: {
        invoiced,
        collected,
        outstanding: round2HalfUp(invoiced - collected),
        collectionRatePct: pct(collected, invoiced),
        verifiedRevenue: sum(accrualRows.map((a) => Number(a.amount))),
        atRisk,
        topActions: findings.filter((f) => f.amountPhp > 0).slice(0, 3).map((f) => ({ title: f.title, amountPhp: f.amountPhp, whatToDo: f.whatToDo })),
      },
      kpis: [
        { label: 'Collection rate', value: pct(collected, invoiced), unit: 'pct', meaning: 'Of every peso invoiced this period, how much is already in. Below 80% means cash is building up with customers.' },
        { label: 'Average days to pay', value: daysToPay.length ? round2HalfUp(sum(daysToPay) / daysToPay.length) : null, unit: 'days', meaning: 'How long customers take from invoice to payment. Each extra day is the yard lending them money.' },
        { label: 'Fleet utilization', value: util.length ? round2HalfUp(sum(util.map((f) => f.utilizationPct)) / util.length) : null, unit: 'pct', meaning: 'The share of the fleet\'s time out earning. Low utilization means too many machines for the work.' },
        { label: 'Outstanding this period', value: round2HalfUp(invoiced - collected), unit: 'php', meaning: 'Invoiced this period and not yet collected.' },
      ],
      findings,
      master: {
        fleetTotal: fleet.length,
        fleetByStatus: tally(fleet.map((e) => e.availabilityStatus)),
        maintenanceDue: util.filter((f) => f.maintenanceDue).length,
        customersTotal: customerRows.length,
        customersKycApproved: customerRows.filter((c) => c.kycStatus === 'approved').length,
        projectSites: siteRows.length,
      },
      ledger: {
        bookings: { count: periodBookings.length, byStatus: tally(periodBookings.map((r) => r.status)) },
        quotations: rootQuotes.length,
        truckTrips: tripRows.length,
        invoicesByType: invoiceRows.reduce<Record<string, number>>(
          (acc, i) => ({ ...acc, [i.invoiceType]: round2HalfUp((acc[i.invoiceType] ?? 0) + Number(i.amount)) }),
          {},
        ),
        payments: { count: paymentRows.length, paid: collected },
        depositDeductions: { count: accrualRows.length, amount: sum(accrualRows.map((a) => Number(a.amount))) },
      },
    };
  });
}
