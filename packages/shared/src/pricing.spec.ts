import { describe, expect, it } from 'vitest';
import { RateCardCreateRequestSchema, RateCardListQuerySchema, rateBreakdown } from './pricing.js';
import { rentFor } from './quotes.js';

describe('RateCardListQuerySchema', () => {
  it('reads the query text "false" as false, so retired cards stay hidden', () => {
    expect(RateCardListQuerySchema.parse({ includeSuperseded: 'false' }).includeSuperseded).toBe(false);
    expect(RateCardListQuerySchema.parse({ includeSuperseded: 'true' }).includeSuperseded).toBe(true);
    expect(RateCardListQuerySchema.parse({}).includeSuperseded).toBe(false);
  });
});

describe('rateBreakdown', () => {
  const costs = { operatorHourlyPhp: 150, maintenanceHourlyPhp: 50, fuelLPerHour: 12 };
  it('splits the all-in rate so the parts sum back to it', () => {
    const b = rateBreakdown(1200, costs, 60)!;
    expect(b).toMatchObject({ fuel: 720, rent: 280 });
    expect(b.rent + b.operator + b.maintenance + b.fuel).toBe(1200);
  });
  it('moves only fuel and rent when diesel changes', () => {
    const b = rateBreakdown(1200, costs, 65)!;
    expect(b).toMatchObject({ allIn: 1200, operator: 150, maintenance: 50, fuel: 780, rent: 220 });
  });
  it('refuses costs above the rate', () => {
    expect(rateBreakdown(1200, costs, 90)).toBeNull();
  });
});

describe('rentFor', () => {
  it('charges rate x hours as one hourly part', () => {
    expect(rentFor(1000, 40)).toEqual({ rentPhp: 40_000, parts: [{ rateType: 'hourly', ratePhp: 1000, count: 40 }] });
  });
});

describe('RateCardCreateRequestSchema', () => {
  const base = { equipmentTypeId: '00000000-0000-4000-8000-000000000001', rateValue: 1000 };
  it('accepts only hourly cards', () => {
    expect(RateCardCreateRequestSchema.safeParse({ ...base, rateType: 'hourly' }).success).toBe(true);
    expect(RateCardCreateRequestSchema.safeParse({ ...base, rateType: 'daily' }).success).toBe(false);
    expect(RateCardCreateRequestSchema.safeParse({ ...base, rateType: 'monthly' }).success).toBe(false);
  });
});
