import { and, eq, inArray, isNull } from 'drizzle-orm';
import { notificationEmail, renderEmailHtml, round2HalfUp, tenantWebOrigin } from '@arkilaunch/shared';
import { customers, depositAccruals, edtr, edtrReconciliations, equipment, equipmentTypes, invoiceLineItems, invoices, notifications, rentals, tenants, users } from './schema/index.js';
import { publicPhotoUrl } from './public-url.js';
import { coverAccruals, getBillingSettings, resolveDepositLedger } from './deposit-ledger.js';
import type { Tx } from './with-tenant-tx.js';

export interface WeeklyInvoiceMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// RFC-2: bills only accruals a reconciled or human-approved pair created. Shared by the Monday cron and the
// office's "Approve & bill"; `accrualIds` narrows it to one week. The cron bypasses RLS, so every read and
// write names its tenant_id (RFC-1). The caller sends `mail` after its transaction commits, so a rollback mails nobody.
export async function issueWeeklyInvoice(
  tx: Tx,
  opts: { tenantId: string; rentalId: string; accrualIds?: string[]; weekStart?: string; invoiceType?: 'weekly' | 'weekly_correction' },
): Promise<{ invoiceId: string; amount: number; mail: WeeklyInvoiceMail | null } | null> {
  const { tenantId, rentalId, accrualIds } = opts;
  if (accrualIds && accrualIds.length === 0) return null;
  // Locked so a concurrent run cannot bill the same rows twice.
  let rows = await tx
    .select()
    .from(depositAccruals)
    .where(
      and(
        eq(depositAccruals.tenantId, tenantId),
        eq(depositAccruals.rentalId, rentalId),
        isNull(depositAccruals.invoiceId),
        accrualIds ? inArray(depositAccruals.id, accrualIds) : undefined,
      ),
    )
    .for('update');
  if (rows.length === 0) return null;
  const [rental] = await tx.select({ mode: rentals.depositMode }).from(rentals)
    .where(and(eq(rentals.tenantId, tenantId), eq(rentals.id, rentalId))).limit(1);

  // Deposit first: whatever consumable deposit is left pays these hours before anything is invoiced. Off only
  // when the office's switch sends every hour to the invoice (Settings > Deposit and billing).
  const { skipDepositForEdtr } = await getBillingSettings(tx, tenantId);
  const [depositPaid] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.rentalId, rentalId),
        inArray(invoices.invoiceType, ['deposit', 'booking']),
        eq(invoices.status, 'paid'),
      ),
    )
    .limit(1);
  if (rental?.mode !== 'per_machine' && !skipDepositForEdtr && depositPaid) {
    const ledger = await resolveDepositLedger(tx, rentalId, tenantId);
    const balance = Math.max(0, ledger.depositRequired - ledger.totalDeducted);
    const { covered, remaining } = coverAccruals(
      balance,
      rows.map((r) => ({ id: r.id, amount: Number(r.amount), hours: Number(r.hours) })),
    );
    if (covered.length > 0) {
      const deducted = round2HalfUp(covered.reduce((s, c) => s + c.amount, 0));
      const [deduction] = await tx
        .insert(invoices)
        .values({ tenantId, rentalId, invoiceType: 'deposit_deduction', amount: String(deducted), status: 'issued', dueDate: new Date() })
        .returning();
      if (!deduction) throw new Error('deposit deduction insert returned no row');
      await tx.insert(invoiceLineItems).values(
        covered.map((c) => {
          const src = rows.find((r) => r.id === c.row.id)!;
          return {
            tenantId,
            invoiceId: deduction.id,
            reconciliationId: src.reconciliationId,
            description: `Hours from the deposit (EDTR reconciliation ${src.reconciliationId})`,
            quantity: String(c.hours),
            unitPrice: src.unitPrice,
            amount: String(c.amount),
          };
        }),
      );
      // Paid in full by the deposit: no longer waiting. Part-paid: only the rest waits for the invoice.
      const rest = new Map(remaining.map((r) => [r.row.id, r]));
      const gone = covered.filter((c) => !rest.has(c.row.id)).map((c) => c.row.id);
      if (gone.length) await tx.delete(depositAccruals).where(and(eq(depositAccruals.tenantId, tenantId), inArray(depositAccruals.id, gone)));
      for (const r of remaining) {
        if (covered.some((c) => c.row.id === r.row.id)) {
          await tx
            .update(depositAccruals)
            .set({ amount: String(r.amount), hours: String(r.hours) })
            .where(and(eq(depositAccruals.tenantId, tenantId), eq(depositAccruals.id, r.row.id)));
        }
      }
      rows = rows
        .filter((r) => rest.has(r.id))
        .map((r) => ({ ...r, amount: String(rest.get(r.id)!.amount), hours: String(rest.get(r.id)!.hours) }));
      if (rows.length === 0) return null;
    }
  }

  const amount = round2HalfUp(rows.reduce((sum, row) => sum + Number(row.amount), 0));

  const [invoice] = await tx
    .insert(invoices)
    .values({
      tenantId,
      rentalId,
      invoiceType: opts.invoiceType ?? 'weekly',
      billingWeekStart: opts.weekStart ?? null,
      amount: String(amount),
      status: 'issued',
      dueDate: new Date(Date.now() + 7 * 86_400_000),
    })
    .returning();
  if (!invoice) throw new Error('weekly invoice insert returned no row');

  const detail = await tx.select({ accrualId: depositAccruals.id, equipmentId: edtr.equipmentId,
    typeName: equipmentTypes.name, model: equipment.model, serialNo: equipment.serialNo, day: edtr.reportDate })
    .from(depositAccruals).innerJoin(edtrReconciliations, and(eq(edtrReconciliations.id, depositAccruals.reconciliationId), eq(edtrReconciliations.tenantId, tenantId)))
    .innerJoin(edtr, and(eq(edtr.id, edtrReconciliations.edtrId), eq(edtr.tenantId, tenantId)))
    .innerJoin(equipment, and(eq(equipment.id, edtr.equipmentId), eq(equipment.tenantId, tenantId)))
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
    .where(and(eq(depositAccruals.tenantId, tenantId), inArray(depositAccruals.id, rows.map((row) => row.id))));
  const byId = new Map(detail.map((row) => [row.accrualId, row]));
  await tx.insert(invoiceLineItems).values(rows.map((row) => {
    const unit = byId.get(row.id);
    if (!unit) throw new Error(`weekly_accrual_equipment_missing:${row.id}`);
    return {
      tenantId,
      invoiceId: invoice.id,
      reconciliationId: row.reconciliationId,
      equipmentId: unit.equipmentId,
      description: `${unit.typeName} ${unit.model} (SN ${unit.serialNo}) - ${unit.day}`,
      quantity: row.hours,
      unitPrice: row.unitPrice,
      amount: row.amount,
    };
  }));
  await tx
    .update(depositAccruals)
    .set({ invoiceId: invoice.id })
    .where(and(eq(depositAccruals.tenantId, tenantId), inArray(depositAccruals.id, rows.map((row) => row.id))));

  let mail: WeeklyInvoiceMail | null = null;
  const [owner] = await tx
    .select({ userId: users.id, code: rentals.code, email: users.email, prefs: users.notificationPrefs })
    .from(rentals)
    .innerJoin(customers, and(eq(customers.id, rentals.customerId), eq(customers.tenantId, tenantId)))
    .leftJoin(users, and(eq(users.id, customers.userId), eq(users.tenantId, tenantId)))
    .where(and(eq(rentals.tenantId, tenantId), eq(rentals.id, rentalId)))
    .limit(1);
  if (owner?.userId) {
    await tx.insert(notifications).values({
      tenantId,
      userId: owner.userId,
      notificationType: 'weekly_invoice',
      payload: { rental_id: rentalId, invoice_id: invoice.id, amount_php: amount },
    });
    const [tenant] = await tx
      .select({ name: tenants.legalName, slug: tenants.slug, logoKey: tenants.logoKey, color: tenants.primaryColor })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const email =
      owner.email && owner.prefs?.email && tenant
        ? notificationEmail(
            'weekly_invoice',
            { invoiceId: invoice.id, invoiceType: opts.invoiceType ?? 'weekly', code: owner.code, amountPhp: amount, dueDate: invoice.dueDate, rentalId, truckRequestId: null },
            'customer',
            tenantWebOrigin(tenant.slug, process.env.WEB_ORIGIN ?? 'http://localhost:5173', process.env.PLATFORM_DOMAIN),
          )
        : null;
    if (email && owner.email && tenant) {
      const html = renderEmailHtml({ name: tenant.name, logoUrl: publicPhotoUrl(tenant.logoKey), color: tenant.color }, email.text);
      mail = { to: owner.email, ...email, html };
    }
  }
  return { invoiceId: invoice.id, amount, mail };
}
