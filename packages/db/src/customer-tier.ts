import { and, eq, sql } from 'drizzle-orm';
import {
  DEFAULT_TIER_POLICY,
  TierPolicySchema,
  capPct,
  tierFor,
  tierScore,
  type CustomerTier,
  type CustomerTierResponse,
  type TierPolicy,
  type TierStats,
} from '@arkilaunch/shared';
import { auditLogs } from './schema/tenancy.js';
import { billingSettings } from './schema/billing.js';
import { customers } from './schema/customers.js';
import type { Tx } from './with-tenant-tx.js';

export async function getTierPolicy(tx: Tx, tenantId: string): Promise<TierPolicy> {
  const [row] = await tx
    .select({ tierPolicy: billingSettings.tierPolicy })
    .from(billingSettings)
    .where(eq(billingSettings.tenantId, tenantId))
    .limit(1);
  const parsed = TierPolicySchema.safeParse(row?.tierPolicy);
  return parsed.success ? parsed.data : DEFAULT_TIER_POLICY;
}

// Every query names the tenant, so this is safe on the job's RLS-bypassing connection too.
async function tierStats(tx: Tx, tenantId: string, customerId: string): Promise<TierStats & { hasOverdue: boolean }> {
  const rows = await tx.execute(sql`
    WITH inv AS (
      SELECT i.id, i.status, i.amount, i.due_date,
        (SELECT min(p.created_at) FROM payments p
          WHERE p.tenant_id = ${tenantId} AND p.invoice_id = i.id AND p.status = 'paid') AS paid_at
      FROM invoices i JOIN rentals r ON r.id = i.rental_id AND r.tenant_id = ${tenantId}
      WHERE i.tenant_id = ${tenantId} AND r.customer_id = ${customerId} AND i.status IN ('issued', 'paid')
    )
    SELECT
      (SELECT count(*) FROM inv WHERE status = 'paid')::int AS invoices_settled,
      (SELECT count(*) FROM inv WHERE status = 'paid' AND (paid_at IS NULL OR paid_at <= due_date))::int AS invoices_on_time,
      (SELECT count(*) FROM inv WHERE due_date >= now() - interval '90 days' AND due_date < now()
        AND (status = 'issued' OR paid_at > due_date))::int AS overdue_last_90d,
      (SELECT count(*) FROM inv WHERE status = 'issued' AND due_date < now())::int AS has_overdue,
      (SELECT coalesce(sum(amount), 0) FROM inv WHERE status = 'paid' AND due_date >= now() - interval '12 months')::float AS booking_value_12m,
      (SELECT count(*) FROM rentals WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND status = 'completed')::int AS completed_rentals,
      (SELECT count(*) FROM rentals WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND created_at >= now() - interval '12 months')::int AS rentals_12m,
      (SELECT count(*) FROM rentals WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND status = 'cancelled' AND created_at >= now() - interval '12 months')::int AS cancelled_12m,
      (SELECT count(DISTINCT rental_id) FROM quotations WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND created_at >= now() - interval '12 months')::int AS quotes_12m,
      (SELECT count(DISTINCT m.rental_id) FROM negotiation_messages m JOIN rentals r ON r.id = m.rental_id AND r.tenant_id = ${tenantId}
        WHERE m.tenant_id = ${tenantId} AND r.customer_id = ${customerId} AND m.author_role = 'customer'
          AND m.created_at >= now() - interval '12 months')::int AS negotiated_12m,
      (SELECT floor(extract(epoch FROM now() - created_at) / 2629800) FROM customers WHERE tenant_id = ${tenantId} AND id = ${customerId})::int AS months
  `);
  const r = (Array.isArray(rows) ? rows[0] : (rows as { rows: unknown[] }).rows[0]) as Record<string, number>;
  return {
    invoicesSettled: Number(r.invoices_settled),
    invoicesOnTime: Number(r.invoices_on_time),
    overdueLast90d: Number(r.overdue_last_90d),
    hasOverdue: Number(r.has_overdue) > 0,
    completedRentals: Number(r.completed_rentals),
    monthsAsCustomer: Number(r.months ?? 0),
    bookingValue12mPhp: Number(r.booking_value_12m),
    rentals12m: Number(r.rentals_12m),
    cancelled12m: Number(r.cancelled_12m),
    quotes12m: Number(r.quotes_12m),
    negotiatedQuotes12m: Number(r.negotiated_12m),
  };
}

// Recomputes and stores the tier. A tier change is audit-logged when a user caused it;
// audit_logs.actor_id is NOT NULL, so scheduler runs rely on tier_computed_at instead.
export async function recomputeCustomerTier(
  tx: Tx,
  tenantId: string,
  customerId: string,
  actorId: string | null = null,
): Promise<{ tier: CustomerTier; score: number }> {
  const stats = await tierStats(tx, tenantId, customerId);
  const policy = await getTierPolicy(tx, tenantId);
  const score = tierScore(stats);
  const tier = tierFor(score, policy, stats.invoicesSettled);
  const [before] = await tx
    .select({ tier: customers.tier })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)))
    .limit(1);
  await tx
    .update(customers)
    .set({ tier, tierScore: score, tierComputedAt: new Date() })
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  if (actorId && before && before.tier !== tier) {
    await tx.insert(auditLogs).values({
      tenantId,
      actorId,
      action: 'UPDATE',
      entity: 'customers',
      entityId: customerId,
      reason: `tier ${before.tier} -> ${tier} (score ${score})`,
    });
  }
  return { tier, score };
}

// Reads the stored tier; the overdue check is live so paying up re-opens negotiation at once.
export async function customerTier(tx: Tx, tenantId: string, customerId: string): Promise<CustomerTierResponse> {
  const [row] = await tx
    .select({ tier: customers.tier, score: customers.tierScore })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)))
    .limit(1);
  const tier = (row?.tier ?? 'bronze') as CustomerTier;
  const rows = await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM invoices i JOIN rentals r ON r.id = i.rental_id AND r.tenant_id = ${tenantId}
      WHERE i.tenant_id = ${tenantId} AND r.customer_id = ${customerId} AND i.status = 'issued' AND i.due_date < now()) AS overdue
  `);
  const first = (Array.isArray(rows) ? rows[0] : (rows as { rows: unknown[] }).rows[0]) as { overdue: boolean };
  const hasOverdue = Boolean(first?.overdue);
  return {
    tier,
    score: row?.score ?? null,
    capPct: capPct(tier, await getTierPolicy(tx, tenantId), hasOverdue),
    hasOverdue,
    eligible: !hasOverdue,
  };
}
