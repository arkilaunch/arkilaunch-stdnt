import { describe, expect, it } from 'vitest';
import { releaseLines } from './void-invoice.js';

const line = (reconciliationId: string, hours: number, amount: number) => ({ reconciliationId, hours, amount, unitPrice: 1200 });

describe('releaseLines (voided deposit bill back to waiting)', () => {
  it('turns each line into a new waiting row when the day had none', () => {
    expect(releaseLines([], [line('a', 7.5, 9000), line('b', 9.5, 11400)])).toEqual({
      refused: false,
      upserts: [
        { reconciliationId: 'a', hours: 7.5, amount: 9000, unitPrice: 1200, isNew: true },
        { reconciliationId: 'b', hours: 9.5, amount: 11400, unitPrice: 1200, isNew: true },
      ],
    });
  });

  it('adds back onto the part of a day already waiting (the deposit ran out mid-day)', () => {
    const result = releaseLines([{ reconciliationId: 'b', hours: 7, amount: 8400, onLiveInvoice: false }], [line('b', 2.5, 3000)]);
    expect(result).toEqual({ refused: false, upserts: [{ reconciliationId: 'b', hours: 9.5, amount: 11400, unitPrice: 1200, isNew: false }] });
  });

  it('refuses while the rest of that day is on a live weekly bill, so nothing is counted twice', () => {
    expect(releaseLines([{ reconciliationId: 'b', hours: 7, amount: 8400, onLiveInvoice: true }], [line('b', 2.5, 3000)])).toEqual({ refused: true });
  });
});
