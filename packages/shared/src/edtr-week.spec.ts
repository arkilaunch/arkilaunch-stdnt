import { describe, expect, it } from 'vitest';
import { weekBillBlock } from './edtr.js';

const decided = [
  { date: '2026-10-07', status: 'approved' as const },
  { date: '2026-10-08', status: 'approved' as const },
  { date: '2026-10-11', status: 'missing' as const },
];
const req = (weekBillableHours: number, sheetBillableHours: number | null, mismatchNote?: string) => ({
  weekBillableHours,
  sheetBillableHours,
  ...(mismatchNote !== undefined ? { mismatchNote } : {}),
});

describe('weekBillBlock', () => {
  it('holds the week while any logged day is undecided; a day with no log does not hold it', () => {
    const days = [...decided, { date: '2026-10-09', status: 'pending' as const }, { date: '2026-10-10', status: 'needs_correction' as const }];
    expect(weekBillBlock({ days, billableHours: 15, request: req(15, null) })).toEqual({
      error: 'week_not_reviewed',
      dates: ['2026-10-09', '2026-10-10'],
    });
    expect(weekBillBlock({ days: decided, billableHours: 15, request: req(15, null) })).toBeNull();
  });

  it('refuses a total the screen showed before another day changed', () => {
    expect(weekBillBlock({ days: decided, billableHours: 16, request: req(15, null) })).toEqual({ error: 'week_total_changed', billableHours: 16 });
  });

  it('needs a written reason when the days do not add up to the sheet WEEK SUMMARY', () => {
    expect(weekBillBlock({ days: decided, billableHours: 32, request: req(32, 33) })).toEqual({ error: 'week_summary_mismatch', sheet: 33, days: 32 });
    expect(weekBillBlock({ days: decided, billableHours: 32, request: req(32, 33, 'ok') })).not.toBeNull();
    expect(weekBillBlock({ days: decided, billableHours: 32, request: req(32, 33, 'timekeeper added 10/09 twice') })).toBeNull();
    expect(weekBillBlock({ days: decided, billableHours: 33, request: req(33, 33.05) })).toBeNull();
  });
});
