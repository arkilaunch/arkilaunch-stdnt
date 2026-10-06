import type { BookingDetailResponse, TruckRequestResponse } from '@arkilaunch/shared';
import { formatDate, formatPeso } from './format.js';

// The text a customer pastes into the tenant's Messenger when in-app negotiation is off.
// Greeting first, so the paste reads as a message rather than a data dump.
function compose(tenantName: string, what: string, lines: (string | null | false | undefined)[]): string {
  const name = tenantName || 'there';
  return [
    `Hi ${name}! I'd like to discuss the price of my ${what}. My details are below.`,
    '',
    `(Pasted from the ${tenantName || 'rental'} booking system)`,
    ...lines.filter((l): l is string => Boolean(l)),
  ].join('\n');
}

// Draft and superseded quotes are still being priced, so no price is quoted for them.
export function bookingMessage(tenantName: string, b: BookingDetailResponse): string {
  const site = [b.siteCity, b.siteProvince].filter(Boolean).join(', ');
  const contact = [b.siteContact, b.siteContactMobile].filter(Boolean).join(', ');
  const q = b.quotation;
  const priced = q && q.status !== 'draft' && q.status !== 'superseded';
  return compose(tenantName, 'booking', [
    `Booking: ${b.code}`,
    b.customerName && `Name: ${b.customerName}`,
    site && `Site: ${site}`,
    contact && `Site contact: ${contact}`,
    b.items.length > 0 && 'Equipment:',
    ...b.items.map((i) => `- ${i.equipmentName ?? 'Equipment'}: ${formatDate(i.start)} to ${i.end ? formatDate(i.end) : 'open-ended'}`),
    priced &&
      `Quote rev ${q.revision}: ${[
        q.mobilizationPhp != null && `mobilization ${formatPeso(q.mobilizationPhp)}`,
        q.demobilizationPhp != null && `demobilization ${formatPeso(q.demobilizationPhp)}`,
        `total ${formatPeso(q.totalPhp)}`,
      ]
        .filter(Boolean)
        .join(', ')}`,
  ]);
}

export function truckMessage(tenantName: string, r: TruckRequestResponse, price: { amount: number; note: string }): string {
  return compose(tenantName, 'truck request', [
    `Truck request: ${r.code}`,
    (r.requesterName || r.companyName) && `Name: ${[r.requesterName, r.companyName].filter(Boolean).join(', ')}`,
    `Route: ${r.pickup} to ${r.dropoff}`,
    `Date: ${formatDate(r.scheduledFor)}`,
    r.loadDescription && `Load: ${r.loadDescription}`,
    `Price: ${formatPeso(price.amount)}${price.note ? ` (${price.note})` : ''}`,
  ]);
}
