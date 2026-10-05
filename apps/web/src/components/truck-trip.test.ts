import { describe, expect, it } from 'vitest';
import { tripArrivalText, tripSteps } from './truck-trip.js';

const done = (r: Parameters<typeof tripSteps>[0]) => tripSteps(r).filter((s) => s.done).map((s) => s.label);

describe('tripSteps', () => {
  it('walks the request from estimate to paid', () => {
    expect(done({ status: 'estimated', confirmedKm: null, callConfirmedAt: null })).toEqual(['Requested']);
    expect(done({ status: 'km_confirmed', confirmedKm: 12, callConfirmedAt: null })).toEqual(['Requested', 'Distance confirmed']);
    expect(done({ status: 'paid', confirmedKm: 12, callConfirmedAt: null })).toHaveLength(5);
    expect(done({ status: 'dispatched', confirmedKm: 12, callConfirmedAt: null })).toHaveLength(6);
  });

  it('marks the call on its own evidence, before the price is agreed', () => {
    expect(done({ status: 'estimated', confirmedKm: null, callConfirmedAt: '2026-09-27T08:00:00Z' })).toEqual([
      'Requested',
      'Confirmed by call',
    ]);
  });

  it('counts the price only once the customer accepted the current one', () => {
    const agreed = { status: 'agreed' as const, confirmedKm: 12, callConfirmedAt: null, agreedPricePhp: 1500 };
    expect(done({ ...agreed, acceptedPricePhp: null })).not.toContain('Price accepted');
    expect(done({ ...agreed, acceptedPricePhp: 1400 })).not.toContain('Price accepted');
    expect(done({ ...agreed, acceptedPricePhp: 1500 })).toContain('Price accepted');
  });
});

describe('trip arrival display', () => {
  const trip = { scheduledFor: '2026-10-05T00:00:00Z', routeCities: null }; // Mon 8:00 AM Manila

  it('shows a clock-time range from the booked pickup before dispatch', () => {
    // QA case: 70 truck min at the 8 AM rush becomes 91-114 min.
    expect(tripArrivalText({ ...trip, routeMinutes: 70, etaAt: null })).toBe(
      'Est. arrival Mon, Oct 5, 9:31 AM – 9:54 AM (91–114 min truck drive)',
    );
    const offPeak = tripArrivalText({ ...trip, scheduledFor: '2026-10-05T04:00:00Z', routeMinutes: 70, etaAt: null });
    expect(offPeak).toContain('(70–88 min truck drive)');
  });

  it('shows the saved ETA after dispatch, and nothing without a route', () => {
    expect(tripArrivalText({ ...trip, routeMinutes: 45, etaAt: '2026-09-29T02:00:00Z' })).toContain('Est. arrival');
    expect(tripArrivalText({ ...trip, routeMinutes: 45, etaAt: '2026-09-29T02:00:00Z' })).not.toContain('truck drive');
    expect(tripArrivalText({ ...trip, routeMinutes: null, etaAt: null })).toBeNull();
  });
});
