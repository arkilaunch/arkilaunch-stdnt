import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { billingSettings, depositAccruals, edtr, edtrReconciliations, invoiceLineItems, invoices, payments, rentalEquipmentDeposits } from './schema/billing.js';
import { equipment } from './schema/fleet.js';
import { equipmentAssignments, quotationItems, quotations, rentalContracts, rentals } from './schema/rentals.js';
import type { Tx } from './with-tenant-tx.js';
import { round2HalfUp } from '@arkilaunch/shared';


// Checkout and deduction both read the minimum through here so they cannot drift.
// ponytail: a no-contract rental reads the CURRENT setting, not the amount
// charged at its checkout; store it on the rental if tenants change it often.
export const DEFAULT_DEPOSIT_PHP = 5000;
export const DEFAULT_HOLD_HOURS = 48;

export interface BillingSettings {
  dailyHours: number;
  minDepositPhp: number;
  lowBalancePct: number;
  depositPct: number;
  mobilizationPhp: number;
  demobilizationPhp: number;
  minHours: number;
  holdHours: number;
  skipDepositForEdtr: boolean;
  skipOcrAccuracyGate: boolean;
}

export async function getBillingSettings(tx: Tx, tenantId: string): Promise<BillingSettings> {
  const [row] = await tx.select().from(billingSettings).where(eq(billingSettings.tenantId, tenantId)).limit(1);
  return {
    dailyHours: row ? Number(row.dailyHours) : 8,
    minDepositPhp: row ? Number(row.minDepositPhp) : DEFAULT_DEPOSIT_PHP,
    lowBalancePct: row ? Number(row.lowBalancePct) : 20,
    depositPct: row ? Number(row.depositPct) : 0,
    mobilizationPhp: row ? Number(row.mobilizationPhp) : 0,
    demobilizationPhp: row ? Number(row.demobilizationPhp) : 0,
    minHours: row ? Number(row.minHours) : 0,
    holdHours: row ? row.holdHours : DEFAULT_HOLD_HOURS,
    skipDepositForEdtr: row?.skipDepositForEdtr ?? false,
    skipOcrAccuracyGate: row?.skipOcrAccuracyGate ?? false,
  };
}

// depositPct% of the rented hours' worth; not refundable. No hours or pct 0 falls back to the flat minimum.
export function depositForQuote(settings: Pick<BillingSettings, 'minDepositPhp' | 'depositPct'>, rentedHoursValue: number | null): number {
  if (!rentedHoursValue || rentedHoursValue <= 0 || settings.depositPct <= 0) return settings.minDepositPhp;
  return round2HalfUp((rentedHoursValue * settings.depositPct) / 100);
}

export interface DepositDeduction {
  invoiceId: string;
  amount: number;
  createdAt: Date;
}

export interface DepositLedger {
  depositRequired: number;
  deductions: DepositDeduction[];
  totalDeducted: number;
  totalAccrued: number;
  unbilledAccrued: number;
  hoursUsed: number;
  hoursOrdered: number | null;
}

export async function createEquipmentDeposits(tx: Tx, tenantId: string, rentalId: string, quotationId?: string): Promise<number> {
  const [rental] = await tx.select({ mode: rentals.depositMode }).from(rentals)
    .where(and(eq(rentals.tenantId, tenantId), eq(rentals.id, rentalId))).for('update').limit(1);
  if (rental?.mode !== 'per_machine') return 0;
  const assignments = await tx.select({ equipmentId: equipmentAssignments.equipmentId, bookedHours: equipmentAssignments.bookedHours, typeId: equipment.equipmentTypeId })
    .from(equipmentAssignments).innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
    .where(and(eq(equipmentAssignments.tenantId, tenantId), eq(equipmentAssignments.rentalId, rentalId), ne(equipmentAssignments.status, 'cancelled')));
  const rates = quotationId
    ? await tx.select({ typeId: quotationItems.equipmentTypeId, rate: quotationItems.hourlyRatePhp, hours: quotationItems.estimatedHours }).from(quotationItems)
      .where(and(eq(quotationItems.tenantId, tenantId), eq(quotationItems.quotationId, quotationId)))
    : [];
  const settings = await getBillingSettings(tx, tenantId);
  const byUnit = new Map<string, { typeId: string; hours: number }>();
  for (const row of assignments) {
    const current = byUnit.get(row.equipmentId);
    byUnit.set(row.equipmentId, { typeId: row.typeId, hours: (current?.hours ?? 0) + Number(row.bookedHours ?? 0) });
  }
  if (byUnit.size === 0) throw new Error('rental_has_no_equipment');
  const frozen = await tx.select().from(rentalEquipmentDeposits)
    .where(and(eq(rentalEquipmentDeposits.tenantId, tenantId), eq(rentalEquipmentDeposits.rentalId, rentalId)));
  if (frozen.length) {
    if (frozen.length !== byUnit.size || frozen.some((row) => !byUnit.has(row.equipmentId))) {
      throw new Error('equipment_deposit_assignment_changed');
    }
    return round2HalfUp(frozen.reduce((sum, row) => sum + Number(row.required), 0));
  }
  const values = [...byUnit].map(([equipmentId, unit]) => {
    const matching = rates.filter((row) => row.typeId === unit.typeId);
    if (matching.some((row) => row.rate !== matching[0]?.rate || row.hours !== matching[0]?.hours)) throw new Error(`quote_ambiguous_equipment_rate:${equipmentId}`);
    const rate = matching[0];
    if (quotationId && !rate) throw new Error(`quote_missing_equipment_rate:${equipmentId}`);
    return { tenantId, rentalId, equipmentId, required: String(depositForQuote(settings, rate ? Number(rate.hours) * Number(rate.rate) : null)) };
  });
  await tx.insert(rentalEquipmentDeposits).values(values);
  const stored = await tx.select({ required: rentalEquipmentDeposits.required }).from(rentalEquipmentDeposits)
    .where(and(eq(rentalEquipmentDeposits.tenantId, tenantId), eq(rentalEquipmentDeposits.rentalId, rentalId)));
  return round2HalfUp(stored.reduce((sum, row) => sum + Number(row.required), 0));
}

// Allocate net paid invoice money across its original lines in cents. Partial
// refunds reduce the credited deposit on each machine by the same invoice-line
// proportion; neither an unpaid line nor another machine can fund its balance.
export function allocatePaidCents(lines: { id: string; amount: number }[], netPaidPhp: number): Map<string, number> {
  const totalCents = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
  const netCents = Math.max(0, Math.min(totalCents, Math.round(netPaidPhp * 100)));
  if (!totalCents || !netCents) return new Map();
  const shares = lines.map((line) => {
    const exact = netCents * Math.round(line.amount * 100) / totalCents;
    return { id: line.id, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remaining = netCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id))) {
    if (remaining-- <= 0) break;
    share.cents += 1;
  }
  return new Map(shares.map((share) => [share.id, share.cents]));
}

export async function fundedEquipmentDeposits(tx: Tx, tenantId: string, rentalId: string): Promise<Map<string, number>> {
  const caps = await tx.select({ equipmentId: rentalEquipmentDeposits.equipmentId, required: rentalEquipmentDeposits.required })
    .from(rentalEquipmentDeposits).where(and(eq(rentalEquipmentDeposits.tenantId, tenantId), eq(rentalEquipmentDeposits.rentalId, rentalId)));
  const bookingInvoices = await tx.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.rentalId, rentalId), eq(invoices.status, 'paid'), inArray(invoices.invoiceType, ['booking', 'deposit'])));
  const funded = new Map<string, number>();
  for (const invoice of bookingInvoices) {
    const lines = await tx.select({ id: invoiceLineItems.id, equipmentId: invoiceLineItems.equipmentId, amount: invoiceLineItems.amount })
      .from(invoiceLineItems).where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.invoiceId, invoice.id)))
      .orderBy(invoiceLineItems.id);
    const money = await tx.select({ amount: payments.amount, status: payments.status }).from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, invoice.id)));
    const netPaid = money.reduce((sum, row) => sum + (row.status === 'paid' ? Number(row.amount) : row.status === 'refunded' ? -Number(row.amount) : 0), 0);
    const shares = allocatePaidCents(lines.map((line) => ({ id: line.id, amount: Number(line.amount) })), netPaid);
    for (const line of lines) if (line.equipmentId) funded.set(line.equipmentId,
      round2HalfUp((funded.get(line.equipmentId) ?? 0) + (shares.get(line.id) ?? 0) / 100));
  }
  return new Map(caps.map((cap) => [cap.equipmentId, Math.min(Number(cap.required), funded.get(cap.equipmentId) ?? 0)]));
}

export async function resolveEquipmentDepositLedger(tx: Tx, rentalId: string, tenantId: string, equipmentId: string) {
  const [rental] = await tx.select({ mode: rentals.depositMode }).from(rentals)
    .where(and(eq(rentals.tenantId, tenantId), eq(rentals.id, rentalId))).limit(1);
  if (rental?.mode !== 'per_machine') return resolveDepositLedger(tx, rentalId, tenantId);
  const [cap] = await tx.select({ required: rentalEquipmentDeposits.required }).from(rentalEquipmentDeposits)
    .where(and(eq(rentalEquipmentDeposits.tenantId, tenantId), eq(rentalEquipmentDeposits.rentalId, rentalId), eq(rentalEquipmentDeposits.equipmentId, equipmentId))).limit(1);
  if (!cap) throw new Error(`equipment_deposit_missing:${equipmentId}`);
  const deductions = await tx.select({ invoiceId: invoices.id, amount: invoiceLineItems.amount, createdAt: invoices.createdAt, hours: invoiceLineItems.quantity })
    .from(invoiceLineItems).innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
    .innerJoin(edtrReconciliations, eq(edtrReconciliations.id, invoiceLineItems.reconciliationId))
    .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.rentalId, rentalId), eq(invoices.invoiceType, 'deposit_deduction'), ne(invoices.status, 'void'), eq(edtr.equipmentId, equipmentId)));
  const accruals = await tx.select({ amount: depositAccruals.amount, hours: depositAccruals.hours, invoiceId: depositAccruals.invoiceId })
    .from(depositAccruals).innerJoin(edtrReconciliations, eq(edtrReconciliations.id, depositAccruals.reconciliationId))
    .innerJoin(edtr, eq(edtr.id, edtrReconciliations.edtrId))
    .where(and(eq(depositAccruals.tenantId, tenantId), eq(depositAccruals.rentalId, rentalId), eq(edtr.equipmentId, equipmentId)));
  const totalDeducted = round2HalfUp(deductions.reduce((sum, row) => sum + Number(row.amount), 0));
  return {
    depositRequired: Number(cap.required),
    deductions: deductions.map((row) => ({ invoiceId: row.invoiceId, amount: Number(row.amount), createdAt: row.createdAt })),
    totalDeducted,
    totalAccrued: round2HalfUp(accruals.reduce((sum, row) => sum + Number(row.amount), 0)),
    unbilledAccrued: round2HalfUp(accruals.filter((row) => !row.invoiceId).reduce((sum, row) => sum + Number(row.amount), 0)),
    hoursUsed: round2HalfUp(deductions.reduce((sum, row) => sum + Number(row.hours), 0) + accruals.reduce((sum, row) => sum + Number(row.hours), 0)),
    hoursOrdered: null,
  } satisfies DepositLedger;
}

// Before a weekly invoice: the deposit left pays the oldest waiting hours first; only the rest is invoiced.
// Hours split in the same ratio as the money, as splitDeduction's callers do.
export function coverAccruals<T extends { id: string; amount: number; hours: number }>(balance: number, rows: T[]) {
  let left = Math.max(0, round2HalfUp(balance));
  const covered: { row: T; amount: number; hours: number }[] = [];
  const remaining: { row: T; amount: number; hours: number }[] = [];
  for (const row of rows) {
    const take = Math.min(left, round2HalfUp(row.amount));
    left = round2HalfUp(left - take);
    const takeHours = row.amount > 0 ? round2HalfUp((row.hours * take) / row.amount) : 0;
    if (take > 0) covered.push({ row, amount: take, hours: takeHours });
    const rest = round2HalfUp(row.amount - take);
    if (rest > 0) remaining.push({ row, amount: rest, hours: round2HalfUp(row.hours - takeHours) });
  }
  return { covered, remaining, balanceAfter: left };
}

// Never throws: the RFC-2 gate (reconciled or human-approved) ran before.
export function splitDeduction(balanceBefore: number, amount: number) {
  const available = Math.max(0, round2HalfUp(balanceBefore));
  const deducted = Math.min(available, round2HalfUp(amount));
  return { deducted, accrued: round2HalfUp(amount - deducted), balanceAfter: round2HalfUp(available - deducted) };
}

// True only on the charge that takes the balance to or under pct% of the
// deposit, so each rental warns once, not on every later log.
export function crossesLowBalance(depositRequired: number, before: number, after: number, pct: number): boolean {
  const threshold = (depositRequired * pct) / 100;
  return depositRequired > 0 && before > threshold && after <= threshold;
}

// Shared by approve and the ledger read so both compute the same remaining deposit.
export async function resolveDepositLedger(tx: Tx, rentalId: string, tenantId: string): Promise<DepositLedger> {
  const [rental] = await tx.select({ mode: rentals.depositMode }).from(rentals)
    .where(and(eq(rentals.tenantId, tenantId), eq(rentals.id, rentalId))).limit(1);
  const [quotation] = await tx
    .select()
    .from(quotations)
    .where(and(eq(quotations.tenantId, tenantId), eq(quotations.rentalId, rentalId)))
    .orderBy(desc(quotations.createdAt))
    .limit(1);

  let depositRequired: number | null = null;
  let hoursOrdered: number | null = null;
  if (quotation) {
    const [contract] = await tx
      .select()
      .from(rentalContracts)
      .where(and(eq(rentalContracts.tenantId, tenantId), eq(rentalContracts.quotationId, quotation.id)))
      .orderBy(desc(rentalContracts.createdAt))
      .limit(1);
    if (contract) depositRequired = Number(contract.depositRequired);
    const [ordered] = await tx
      .select({ hours: sql<string | null>`sum(${quotationItems.estimatedHours} * ${quotationItems.quantity})` })
      .from(quotationItems)
      .where(and(eq(quotationItems.tenantId, tenantId), eq(quotationItems.quotationId, quotation.id)));
    hoursOrdered = ordered?.hours != null ? Number(ordered.hours) : null;
  }
  if (rental?.mode === 'per_machine') {
    const caps = await tx.select({ required: rentalEquipmentDeposits.required }).from(rentalEquipmentDeposits)
      .where(and(eq(rentalEquipmentDeposits.tenantId, tenantId), eq(rentalEquipmentDeposits.rentalId, rentalId)));
    if (caps.length) depositRequired = round2HalfUp(caps.reduce((sum, row) => sum + Number(row.required), 0));
    else {
      const assignments = await tx.select({ equipmentId: equipmentAssignments.equipmentId }).from(equipmentAssignments)
        .where(and(eq(equipmentAssignments.tenantId, tenantId), eq(equipmentAssignments.rentalId, rentalId), ne(equipmentAssignments.status, 'cancelled')));
      depositRequired = new Set(assignments.map((row) => row.equipmentId)).size * (await getBillingSettings(tx, tenantId)).minDepositPhp;
    }
  }
  if (depositRequired === null) depositRequired = (await getBillingSettings(tx, tenantId)).minDepositPhp;

  const deductionRows = await tx
    .select()
    .from(invoices)
    // A voided deduction gives its hours and money back to the deposit.
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.rentalId, rentalId), eq(invoices.invoiceType, 'deposit_deduction'), ne(invoices.status, 'void')))
    .orderBy(desc(invoices.createdAt));

  const deductions = deductionRows.map((row) => ({
    invoiceId: row.id,
    amount: Number(row.amount),
    createdAt: row.createdAt,
  }));
  const totalDeducted = round2HalfUp(deductions.reduce((sum, deduction) => sum + deduction.amount, 0));

  const deductionHours = deductionRows.length
    ? await tx
        .select({ hours: sql<string | null>`sum(${invoiceLineItems.quantity})` })
        .from(invoiceLineItems)
        .where(and(eq(invoiceLineItems.tenantId, tenantId), inArray(invoiceLineItems.invoiceId, deductionRows.map((row) => row.id))))
    : [];
  const accruals = await tx.select().from(depositAccruals)
    .where(and(eq(depositAccruals.tenantId, tenantId), eq(depositAccruals.rentalId, rentalId)));
  const totalAccrued = round2HalfUp(accruals.reduce((sum, row) => sum + Number(row.amount), 0));
  const unbilledAccrued = round2HalfUp(accruals.filter((row) => !row.invoiceId).reduce((sum, row) => sum + Number(row.amount), 0));
  const hoursUsed = round2HalfUp(
    Number(deductionHours[0]?.hours ?? 0) + accruals.reduce((sum, row) => sum + Number(row.hours), 0),
  );

  return { depositRequired, deductions, totalDeducted, totalAccrued, unbilledAccrued, hoursUsed, hoursOrdered };
}
