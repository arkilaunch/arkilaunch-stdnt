import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { depositAccruals, edtr, edtrReconciliations, issueWeeklyInvoice, rentalBillingWeeks, sendEmail, type WeeklyInvoiceMail } from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runJobIfMain } from './telemetry.js';

// Safety net: only an explicitly closed rental/site week can be billed.
// RLS is bypassed on this connection, so every write names its tenant_id (issueWeeklyInvoice does).
export async function runWeeklyBilling(): Promise<number> {
  const { db, client } = makeJobDb();
  let issued = 0;
  try {
    const open = await db.selectDistinct({ id: rentalBillingWeeks.id, tenantId: rentalBillingWeeks.tenantId,
      rentalId: rentalBillingWeeks.rentalId, weekStart: rentalBillingWeeks.weekStart })
      .from(rentalBillingWeeks)
      .innerJoin(depositAccruals, and(eq(depositAccruals.tenantId, rentalBillingWeeks.tenantId), eq(depositAccruals.rentalId, rentalBillingWeeks.rentalId)))
      .innerJoin(edtrReconciliations, and(eq(edtrReconciliations.id, depositAccruals.reconciliationId), eq(edtrReconciliations.tenantId, rentalBillingWeeks.tenantId)))
      .innerJoin(edtr, and(eq(edtr.id, edtrReconciliations.edtrId), eq(edtr.tenantId, rentalBillingWeeks.tenantId)))
      .where(and(isNull(rentalBillingWeeks.invoiceId), isNull(depositAccruals.invoiceId),
        sql`${edtr.reportDate} >= ${rentalBillingWeeks.weekStart} AND ${edtr.reportDate} < ${rentalBillingWeeks.weekStart} + 7`));

    for (const { id, tenantId, rentalId, weekStart } of open) {
      // Sent after the commit, so a rolled-back run mails nobody.
      let mail: WeeklyInvoiceMail | null = null;
      await db.transaction(async (tx) => {
        const from = new Date(`${weekStart}T00:00:00Z`);
        const to = new Date(from.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
        const accruals = await tx.select({ id: depositAccruals.id }).from(depositAccruals)
          .innerJoin(edtrReconciliations, and(eq(edtrReconciliations.id, depositAccruals.reconciliationId), eq(edtrReconciliations.tenantId, depositAccruals.tenantId)))
          .innerJoin(edtr, and(eq(edtr.id, edtrReconciliations.edtrId), eq(edtr.tenantId, depositAccruals.tenantId)))
          .where(and(eq(depositAccruals.tenantId, tenantId), eq(depositAccruals.rentalId, rentalId),
            isNull(depositAccruals.invoiceId), gte(edtr.reportDate, weekStart), lt(edtr.reportDate, to)));
        const result = await issueWeeklyInvoice(tx, { tenantId, rentalId, accrualIds: accruals.map((row) => row.id), weekStart });
        if (!result) return;
        await tx.update(rentalBillingWeeks).set({ invoiceId: result.invoiceId })
          .where(and(eq(rentalBillingWeeks.tenantId, tenantId), eq(rentalBillingWeeks.id, id), isNull(rentalBillingWeeks.invoiceId)));
        mail = result.mail;
        issued += 1;
      });
      if (mail) {
        const { to, subject, text, html } = mail as WeeklyInvoiceMail;
        await sendEmail(to, subject, text, html).catch((err) => console.error('weekly-billing: invoice email failed', err));
      }
    }
    console.log(`weekly-billing: issued ${issued} weekly invoice(s).`);
    return issued;
  } finally {
    await client.end();
  }
}

runJobIfMain(import.meta.url, 'weekly-billing', runWeeklyBilling);
