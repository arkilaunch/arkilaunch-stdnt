import { and, eq, inArray, ne } from 'drizzle-orm';
import { round2HalfUp } from '@arkilaunch/shared';
import { depositAccruals, invoiceLineItems, invoices } from './schema/billing.js';
import type { Tx } from './with-tenant-tx.js';

export type VoidRefusal = 'invoice_not_found' | 'invoice_not_voidable' | 'invoice_paid_refund_instead' | 'void_weekly_bill_first';

export interface WaitingRow {
  reconciliationId: string;
  hours: number;
  amount: number;
  // The live (non-void) weekly invoice the row sits on, if any.
  onLiveInvoice: boolean;
}

// A voided deduction's lines go back to waiting: merged into the reconciliation's waiting row, or a new one.
// Refused when that row is already on a live weekly bill, so the money is never counted twice.
export function releaseLines(
  existing: WaitingRow[],
  lines: { reconciliationId: string; hours: number; amount: number; unitPrice: number }[],
): { refused: true } | { refused: false; upserts: { reconciliationId: string; hours: number; amount: number; unitPrice: number; isNew: boolean }[] } {
  const byRecon = new Map(existing.map((r) => [r.reconciliationId, r]));
  const out = new Map<string, { reconciliationId: string; hours: number; amount: number; unitPrice: number; isNew: boolean }>();
  for (const line of lines) {
    const prior = byRecon.get(line.reconciliationId);
    if (prior?.onLiveInvoice) return { refused: true };
    const acc = out.get(line.reconciliationId) ?? {
      reconciliationId: line.reconciliationId,
      hours: prior?.hours ?? 0,
      amount: prior?.amount ?? 0,
      unitPrice: line.unitPrice,
      isNew: !prior,
    };
    acc.hours = round2HalfUp(acc.hours + line.hours);
    acc.amount = round2HalfUp(acc.amount + line.amount);
    out.set(line.reconciliationId, acc);
  }
  return { refused: false, upserts: [...out.values()] };
}

// Voids an EDTR bill and puts its field-log hours back to waiting, so "Approve & bill" makes a new bill
// (new invoice row, new INV code). The voided bill and its lines stay as history. Field logs and their
// approvals are untouched: nothing is duplicated. Every read and write names tenant_id (RFC-1).
export async function voidEdtrInvoice(
  tx: Tx,
  opts: { tenantId: string; invoiceId: string },
): Promise<{ ok: true; released: number; rentalId: string | null } | { ok: false; error: VoidRefusal }> {
  const { tenantId, invoiceId } = opts;
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
    .for('update');
  if (!invoice) return { ok: false, error: 'invoice_not_found' };
  if (invoice.status === 'paid') return { ok: false, error: 'invoice_paid_refund_instead' };
  const voidable =
    (invoice.invoiceType === 'weekly' && invoice.status === 'issued') ||
    (invoice.invoiceType === 'deposit_deduction' && invoice.status !== 'void');
  if (!voidable) return { ok: false, error: 'invoice_not_voidable' };

  let released = 0;
  if (invoice.invoiceType === 'weekly') {
    const rows = await tx
      .update(depositAccruals)
      .set({ invoiceId: null })
      .where(and(eq(depositAccruals.tenantId, tenantId), eq(depositAccruals.invoiceId, invoiceId)))
      .returning({ id: depositAccruals.id });
    released = rows.length;
  } else {
    const lines = (
      await tx
        .select()
        .from(invoiceLineItems)
        .where(and(eq(invoiceLineItems.tenantId, tenantId), eq(invoiceLineItems.invoiceId, invoiceId)))
    ).filter((l): l is typeof l & { reconciliationId: string } => !!l.reconciliationId);
    const reconIds = [...new Set(lines.map((l) => l.reconciliationId))];
    const existing = reconIds.length
      ? await tx
          .select({ id: depositAccruals.id, reconciliationId: depositAccruals.reconciliationId, hours: depositAccruals.hours, amount: depositAccruals.amount, invoiceId: depositAccruals.invoiceId, invoiceStatus: invoices.status })
          .from(depositAccruals)
          .leftJoin(invoices, eq(invoices.id, depositAccruals.invoiceId))
          .where(and(eq(depositAccruals.tenantId, tenantId), inArray(depositAccruals.reconciliationId, reconIds)))
          .for('update', { of: depositAccruals })
      : [];
    const plan = releaseLines(
      existing.map((r) => ({
        reconciliationId: r.reconciliationId,
        hours: Number(r.hours),
        amount: Number(r.amount),
        onLiveInvoice: r.invoiceId !== null && r.invoiceStatus !== 'void',
      })),
      lines.map((l) => ({ reconciliationId: l.reconciliationId, hours: Number(l.quantity), amount: Number(l.amount), unitPrice: Number(l.unitPrice) })),
    );
    if (plan.refused) return { ok: false, error: 'void_weekly_bill_first' };
    for (const u of plan.upserts) {
      if (u.isNew) {
        await tx.insert(depositAccruals).values({
          tenantId,
          rentalId: invoice.rentalId!,
          reconciliationId: u.reconciliationId,
          hours: String(u.hours),
          unitPrice: String(u.unitPrice),
          amount: String(u.amount),
        });
      } else {
        // Waiting again: an accrual still pointing at a void weekly bill is released too.
        await tx
          .update(depositAccruals)
          .set({ hours: String(u.hours), amount: String(u.amount), invoiceId: null })
          .where(and(eq(depositAccruals.tenantId, tenantId), eq(depositAccruals.reconciliationId, u.reconciliationId)));
      }
    }
    released = plan.upserts.length;
  }

  await tx
    .update(invoices)
    .set({ status: 'void' })
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId), ne(invoices.status, 'void')));
  return { ok: true, released, rentalId: invoice.rentalId };
}
