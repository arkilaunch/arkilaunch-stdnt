import { isNull } from 'drizzle-orm';
import { depositAccruals, issueWeeklyInvoice, sendEmail, type WeeklyInvoiceMail } from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runJobIfMain } from './telemetry.js';

// Safety net: bills whatever the office has not billed by hand with "Approve & bill".
// RLS is bypassed on this connection, so every write names its tenant_id (issueWeeklyInvoice does).
export async function runWeeklyBilling(): Promise<number> {
  const { db, client } = makeJobDb();
  let issued = 0;
  try {
    const open = await db
      .selectDistinct({ tenantId: depositAccruals.tenantId, rentalId: depositAccruals.rentalId })
      .from(depositAccruals)
      .where(isNull(depositAccruals.invoiceId));

    for (const { tenantId, rentalId } of open) {
      // Sent after the commit, so a rolled-back run mails nobody.
      let mail: WeeklyInvoiceMail | null = null;
      await db.transaction(async (tx) => {
        const result = await issueWeeklyInvoice(tx, { tenantId, rentalId });
        if (!result) return;
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
