import { describe, expect, it } from 'vitest';
import { DEFAULT_TIER_POLICY, capPct, discountPct, tierFor, tierScore, type TierStats } from './tiers.js';

const fresh: TierStats = {
  invoicesSettled: 0, invoicesOnTime: 0, overdueLast90d: 0, completedRentals: 0, monthsAsCustomer: 0,
  bookingValue12mPhp: 0, rentals12m: 0, cancelled12m: 0, quotes12m: 0, negotiatedQuotes12m: 0,
};
const loyal: TierStats = {
  invoicesSettled: 20, invoicesOnTime: 20, overdueLast90d: 0, completedRentals: 10, monthsAsCustomer: 24,
  bookingValue12mPhp: 1_000_000, rentals12m: 10, cancelled12m: 0, quotes12m: 10, negotiatedQuotes12m: 0,
};

describe('tiers', () => {
  it('a new customer is bronze with a 0% cap', () => {
    const score = tierScore(fresh);
    expect(tierFor(score, DEFAULT_TIER_POLICY, 0)).toBe('bronze');
    expect(capPct('bronze', DEFAULT_TIER_POLICY, false)).toBe(0);
  });

  it('stays bronze until the first settled invoice, whatever the score', () => {
    expect(tierFor(100, DEFAULT_TIER_POLICY, 0)).toBe('bronze');
    expect(tierFor(100, DEFAULT_TIER_POLICY, 1)).toBe('platinum');
  });

  it('a perfect customer scores 100 and is platinum', () => {
    expect(tierScore(loyal)).toBe(100);
    expect(tierFor(100, DEFAULT_TIER_POLICY, 20)).toBe('platinum');
  });

  it('maps score boundaries to tiers', () => {
    expect(tierFor(39, DEFAULT_TIER_POLICY, 1)).toBe('bronze');
    expect(tierFor(40, DEFAULT_TIER_POLICY, 1)).toBe('silver');
    expect(tierFor(65, DEFAULT_TIER_POLICY, 1)).toBe('gold');
    expect(tierFor(85, DEFAULT_TIER_POLICY, 1)).toBe('platinum');
  });

  it('overdue invoices cut the payment score', () => {
    expect(tierScore({ ...loyal, overdueLast90d: 4 })).toBe(60);
  });

  it('an overdue balance zeroes the cap', () => {
    expect(capPct('platinum', DEFAULT_TIER_POLICY, true)).toBe(0);
  });

  it('converts fixed discounts to a percent of the subtotal', () => {
    expect(discountPct({ type: 'fixed', value: 500 }, 10_000)).toBe(5);
    expect(discountPct({ type: 'percent', value: 3 }, 10_000)).toBe(3);
    expect(discountPct({ type: 'none', value: 9 }, 10_000)).toBe(0);
  });
});
