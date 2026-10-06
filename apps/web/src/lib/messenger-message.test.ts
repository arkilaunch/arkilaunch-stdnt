import { describe, expect, it } from 'vitest';
import type { BookingDetailResponse, TruckRequestResponse } from '@arkilaunch/shared';
import { bookingMessage, truckMessage } from './messenger-message.js';

const booking = {
  code: 'EQR-2026-0001',
  customerName: 'Juan dela Cruz',
  siteCity: 'Cebu City',
  siteProvince: 'Cebu',
  siteContact: 'Maria Santos',
  siteContactMobile: '09171234567',
  items: [{ equipmentName: 'Excavator 20t', start: new Date('2026-10-08T00:00:00Z'), end: new Date('2026-10-12T00:00:00Z') }],
  quotation: { revision: 2, status: 'approved', totalPhp: 85000, mobilizationPhp: 5000, demobilizationPhp: 5000 },
} as unknown as BookingDetailResponse;

describe('bookingMessage', () => {
  it('greets, attributes the paste, then lists the billing details', () => {
    const lines = bookingMessage('Almara Construction', booking).split('\n');
    expect(lines[0]).toMatch(/^Hi Almara Construction! /);
    expect(lines[2]).toBe('(Pasted from the Almara Construction booking system)');
    expect(lines).toEqual(
      expect.arrayContaining([
        'Booking: EQR-2026-0001',
        'Name: Juan dela Cruz',
        'Site: Cebu City, Cebu',
        'Site contact: Maria Santos, 09171234567',
        'Equipment:',
        expect.stringMatching(/^- Excavator 20t: Oct 8, 2026 to Oct 12, 2026$/),
        expect.stringMatching(/^Quote rev 2: mobilization ₱5,000\.00, demobilization ₱5,000\.00, total ₱85,000\.00$/),
      ]),
    );
  });

  it('quotes no price while the quote is still being priced', () => {
    for (const quotation of [null, { ...booking.quotation, status: 'draft' }]) {
      expect(bookingMessage('Almara', { ...booking, quotation } as BookingDetailResponse)).not.toMatch(/Quote rev/);
    }
  });
});

describe('truckMessage', () => {
  it('lists the trip and the price with its note', () => {
    const r = { code: 'TRK-2026-0001', requesterName: 'Juan', companyName: null, pickup: 'Mandaue', dropoff: 'Talisay', scheduledFor: '2026-10-08T00:00:00Z', loadDescription: null } as unknown as TruckRequestResponse;
    const text = truckMessage('Almara', r, { amount: 12000, note: 'estimated' });
    expect(text).toContain('Truck request: TRK-2026-0001');
    expect(text).toContain('Route: Mandaue to Talisay');
    expect(text).toContain('Price: ₱12,000.00 (estimated)');
    expect(text).not.toContain('Load:');
  });
});
