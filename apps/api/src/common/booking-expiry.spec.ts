import { describe, expect, it } from 'vitest';
import { rentalExpiryCutoff, rentalStartPassed, truckSchedulePassed } from './booking-expiry.js';

describe('booking expiry boundaries', () => {
  it('keeps a rental active throughout its Manila start date', () => {
    const now = new Date('2026-11-11T15:59:59Z');
    expect(rentalExpiryCutoff(now).toISOString()).toBe('2026-11-10T16:00:00.000Z');
    expect(rentalStartPassed(new Date('2026-11-10T16:00:00Z'), now)).toBe(false);
    expect(rentalStartPassed(new Date('2026-11-09T16:00:00Z'), now)).toBe(true);
  });

  it('expires a truck trip only after its exact scheduled instant', () => {
    const when = new Date('2026-11-11T08:00:00Z');
    expect(truckSchedulePassed(when, when)).toBe(false);
    expect(truckSchedulePassed(when, new Date('2026-11-11T08:00:01Z'))).toBe(true);
  });
});
