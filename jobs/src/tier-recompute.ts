import { customers, recomputeCustomerTier } from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runJobIfMain } from './telemetry.js';

// Daily: refresh every customer's negotiation tier (UC 007.2). Settled invoices
// also recompute on the spot; this catches time-based changes like overdue invoices.
export async function runTierRecompute(): Promise<{ recomputed: number }> {
  const { db, client } = makeJobDb();
  let recomputed = 0;
  try {
    // RLS is bypassed on this connection; recomputeCustomerTier names the tenant on every query.
    const all = await db.select({ id: customers.id, tenantId: customers.tenantId }).from(customers);
    for (const customer of all) {
      await db.transaction((tx) => recomputeCustomerTier(tx, customer.tenantId, customer.id));
      recomputed += 1;
    }
    console.log(`tier-recompute: ${recomputed} customer(s).`);
    return { recomputed };
  } finally {
    await client.end();
  }
}

runJobIfMain(import.meta.url, 'tier-recompute', runTierRecompute);
