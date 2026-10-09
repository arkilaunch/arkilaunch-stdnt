import { describe, expect, it } from 'vitest';
import { banHits, isRushHour, truckArrivalWindow, truckEta, truckMinutes, type TruckBanRuleInput } from './trucks.js';

const rule: TruckBanRuleInput = {
  city: 'Makati', province: 'Metro Manila', days: [1, 2, 3, 4, 5, 6],
  windows: [{ from: '06:00', to: '10:00' }, { from: '17:00', to: '22:00' }],
  minGvwKg: null, permitNote: 'Check permit', verified: false,
};
const cities = [{ city: 'Makati City', province: 'National Capital Region' }];

describe('truck ban windows and ETA', () => {
  it('finds a weekday window and carries its unverified warning', () => {
    const hits = banHits(cities, [rule], new Date('2026-09-28T00:00:00Z')); // Monday 08:00 Manila
    expect(hits).toMatchObject([{ city: 'Makati', window: '06:00-10:00', verified: false, permitNote: 'Check permit' }]);
    expect(hits[0]?.endAt.toISOString()).toBe('2026-09-28T02:00:00.000Z');
  });

  it('skips times and days outside a ban', () => {
    expect(banHits(cities, [rule], new Date('2026-09-28T03:00:00Z'))).toEqual([]);
    expect(banHits(cities, [rule], new Date('2026-09-27T00:00:00Z'))).toEqual([]);
  });

  it('pushes a dispatched ETA to the end of the window', () => {
    expect(truckEta(new Date('2026-09-28T00:00:00Z'), 30, cities, [rule]).toISOString())
      .toBe('2026-09-28T02:00:00.000Z');
    expect(truckEta(new Date('2026-09-28T03:00:00Z'), 30, cities, [rule]).toISOString())
      .toBe('2026-09-28T03:30:00.000Z');
  });

  it('applies the rush-hour factor to a dispatch outside any ban', () => {
    // Tuesday 08:00 Manila, no rules: 60 min becomes 78.
    expect(truckEta(new Date('2026-09-29T00:00:00Z'), 60, [], []).toISOString()).toBe('2026-09-29T01:18:00.000Z');
    // Sunday 08:00 Manila is not a commute.
    expect(truckEta(new Date('2026-09-27T00:00:00Z'), 60, [], []).toISOString()).toBe('2026-09-27T01:00:00.000Z');
  });
});

describe('truck drive time', () => {
  it('scales a car route and never beats the average-speed floor', () => {
    // QA case: Pililla to Taytay, OSRM car 35 km in 48 min.
    expect(truckMinutes(35, 48, false)).toBe(70);
    expect(truckMinutes(35, 48, true)).toBe(70); // the 30 km/h floor wins
    expect(truckMinutes(100, 120, true)).toBe(200); // floor 200 > 138
    expect(truckMinutes(10, 30, false)).toBe(44); // scaled 43.5 > floor 20
  });

  it('knows the weekday commute windows', () => {
    expect(isRushHour(new Date('2026-09-28T23:30:00Z'))).toBe(true); // Tue 07:30
    expect(isRushHour(new Date('2026-09-29T02:00:00Z'))).toBe(false); // Tue 10:00
    expect(isRushHour(new Date('2026-09-29T09:59:00Z'))).toBe(true); // Tue 17:59
    expect(isRushHour(new Date('2026-10-03T00:00:00Z'))).toBe(false); // Sat 08:00
  });

  it('gives an arrival range, both ends pushed past a ban', () => {
    const off = truckArrivalWindow(new Date('2026-09-29T04:00:00Z'), 60); // Tue 12:00
    expect(off.from.toISOString()).toBe('2026-09-29T05:00:00.000Z');
    expect(off.to.toISOString()).toBe('2026-09-29T05:15:00.000Z');
    const banned = truckArrivalWindow(new Date('2026-09-28T00:00:00Z'), 30, cities, [rule]);
    expect(banned.from.toISOString()).toBe('2026-09-28T02:00:00.000Z');
  });
});
