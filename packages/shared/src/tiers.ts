import { z } from 'zod';

// Customer tiers cap how much discount staff may give in a negotiation (UC 005).
export const CUSTOMER_TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];

export const TierPolicySchema = z.object({
  // Minimum score for each tier above bronze.
  thresholds: z.object({
    silver: z.number().min(0).max(100),
    gold: z.number().min(0).max(100),
    platinum: z.number().min(0).max(100),
  }),
  // Max discount, percent of the quote subtotal.
  capsPct: z.object({
    bronze: z.number().min(0).max(100),
    silver: z.number().min(0).max(100),
    gold: z.number().min(0).max(100),
    platinum: z.number().min(0).max(100),
  }),
}).refine((p) => p.thresholds.silver <= p.thresholds.gold && p.thresholds.gold <= p.thresholds.platinum, {
  message: 'thresholds must rise silver <= gold <= platinum',
});
export type TierPolicy = z.infer<typeof TierPolicySchema>;

export const DEFAULT_TIER_POLICY: TierPolicy = {
  thresholds: { silver: 40, gold: 65, platinum: 85 },
  capsPct: { bronze: 0, silver: 3, gold: 5, platinum: 8 },
};

export interface TierStats {
  invoicesSettled: number; // all time
  invoicesOnTime: number; // settled on or before due date
  overdueLast90d: number; // invoices past due in the last 90 days (paid late or still open)
  completedRentals: number;
  monthsAsCustomer: number;
  bookingValue12mPhp: number;
  rentals12m: number;
  cancelled12m: number;
  quotes12m: number;
  negotiatedQuotes12m: number; // quotes the customer pushed back on
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// 0-100: payment history 40, loyalty 30, transaction behavior 30.
// ponytail: weights are fixed; make them part of TierPolicy when an Owner asks to tune them.
export function tierScore(s: TierStats): number {
  const onTime = s.invoicesSettled > 0 ? s.invoicesOnTime / s.invoicesSettled : 0;
  const payment = 40 * clamp01(onTime - 0.25 * s.overdueLast90d);
  const loyalty = 15 * clamp01(s.completedRentals / 10) + 15 * clamp01(s.monthsAsCustomer / 24);
  const cancelRate = s.rentals12m > 0 ? s.cancelled12m / s.rentals12m : 0;
  const negotiateRate = s.quotes12m > 0 ? s.negotiatedQuotes12m / s.quotes12m : 0;
  const behavior = 15 * clamp01(s.bookingValue12mPhp / 1_000_000) + 7.5 * (1 - clamp01(cancelRate)) + 7.5 * (1 - clamp01(negotiateRate));
  return Math.round(payment + loyalty + behavior);
}

// A customer with no settled invoice stays bronze whatever the score.
export function tierFor(score: number, policy: TierPolicy, invoicesSettled: number): CustomerTier {
  if (invoicesSettled < 1) return 'bronze';
  if (score >= policy.thresholds.platinum) return 'platinum';
  if (score >= policy.thresholds.gold) return 'gold';
  if (score >= policy.thresholds.silver) return 'silver';
  return 'bronze';
}

// An overdue balance shuts negotiation off.
export function capPct(tier: CustomerTier, policy: TierPolicy, hasOverdue: boolean): number {
  return hasOverdue ? 0 : policy.capsPct[tier];
}

// The discount as a percent of the subtotal, whatever its type.
export function discountPct(discount: { type: 'none' | 'percent' | 'fixed'; value: number }, subtotalPhp: number): number {
  if (discount.type === 'none' || discount.value <= 0) return 0;
  if (discount.type === 'percent') return discount.value;
  return subtotalPhp > 0 ? (discount.value / subtotalPhp) * 100 : 100;
}

export type CapStatus = 'within' | 'pending_owner' | 'owner_approved' | 'owner_rejected';

export interface CustomerTierResponse {
  tier: CustomerTier;
  score: number | null;
  capPct: number;
  hasOverdue: boolean;
  // false: the customer has an overdue balance and may not negotiate.
  eligible: boolean;
}
