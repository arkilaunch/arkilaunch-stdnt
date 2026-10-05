import { describe, expect, it } from 'vitest';
import { bookingDays, edtrSheetQrPayload, maxBookingHours, minBookingHours, minRentalDays, parseEdtrSheetQr, sheetQrCheck } from './bookings.js';

describe('minBookingHours', () => {
  it('is a full working day for every day the dates span', () => {
    // 1st 08:00 to 3rd 17:00 spans three days.
    const days = bookingDays('2026-10-01T00:00:00Z', '2026-10-03T09:00:00Z');
    expect(days).toBe(3);
    expect(minBookingHours(days, 8)).toBe(24);
  });

  it('caps at every hour of those days', () => {
    expect(maxBookingHours(3)).toBe(72);
  });
});

describe('minRentalDays', () => {
  it('turns the tenant minimum hours into whole working days', () => {
    // 500 h at 8 h a day needs 63 days; 16 or 30 days are too short.
    expect(minRentalDays(8, 500)).toBe(63);
    expect(minBookingHours(63, 8)).toBeGreaterThanOrEqual(500);
  });

  it('is a single day when the tenant sets no minimum', () => {
    expect(minRentalDays(8, 0)).toBe(1);
  });
});

describe('eDTR sheet QR', () => {
  const r = '11111111-2222-4333-8444-555555555555';
  const e = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  it('round-trips the printed payload', () => {
    expect(parseEdtrSheetQr(edtrSheetQrPayload(r, e, '2026-10-05'))).toEqual({ rentalId: r, equipmentId: e, weekStart: '2026-10-05' });
    expect(parseEdtrSheetQr(` ARKI-EDTR3:${r.toUpperCase()}:${e}:2026-10-05\n`)?.rentalId).toBe(r);
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'https://example.com', `ARKI-EDTR2:${r}:${e}:2026-10-05`, `ARKI-EDTR3:${r}:${e}:2026-10-5`, `ARKI-EDTR3:${r}:not-a-uuid:2026-10-05`]) {
      expect(parseEdtrSheetQr(bad)).toBeNull();
    }
  });
});

describe('sheetQrCheck', () => {
  const filed = { rentalId: '11111111-2222-4333-8444-555555555555', equipmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
  const qr = (equipmentId: string) => ({ value: edtrSheetQrPayload(filed.rentalId, equipmentId, '2026-10-05') });
  it('matches its own sheet and catches a swapped one', () => {
    expect(sheetQrCheck([{ value: 'junk' }, qr(filed.equipmentId)], filed)).toBe('match');
    expect(sheetQrCheck([qr('ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee')], filed)).toBe('mismatch');
  });
  it('reports a sheet with no readable QR as missing', () => {
    expect(sheetQrCheck(undefined, filed)).toBe('missing');
    expect(sheetQrCheck([{ value: 'https://example.com' }], filed)).toBe('missing');
  });
});
