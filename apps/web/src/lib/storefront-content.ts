import type { CatalogEquipment } from '@arkilaunch/shared';

// Pure (no DOM, no Vite): the storefront pages and the edge snapshot (lib/snapshot.ts) read the same strings, so what
// a crawler is served is what a visitor sees.

export const HOW_IT_WORKS = [
  { title: 'Browse and see prices', body: 'Every machine shows its published rate. No account needed to look.' },
  { title: 'Request a quote', body: 'Pick dates and a site. The rental team confirms the price with you.' },
  { title: 'Verify your company', body: 'Upload your company documents once. Staff check them before your first booking.' },
  { title: 'Sign and pay', body: 'Sign the rental agreement on screen and pay the deposit to lock in your dates.' },
];

export const HOME_EYEBROW_SUFFIX = 'Equipment and hauling';
export const DEFAULT_TAGLINE = 'Industrial equipment, ready to rent';
export const DEFAULT_SUBHEAD = 'Browse the fleet, see the rates, pick your dates and request a quote online.';
export const CATALOG_TITLE = 'Browse equipment';
// Visitors (and crawlers) are signed out: they get the plain heading, not the console page header.
export const GUEST_CATALOG_TITLE = 'Equipment for hire';
export const CATALOG_DESCRIPTION = 'Pick a machine, set its dates, and add it to your cart.';
export const PREVIEW_COUNT = 6;
export const PRICE_ON_REQUEST = 'Price on request';

// The first sentence of the tenant's About text, so the hero subhead is theirs when they wrote one.
export function firstSentence(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? trimmed;
}

// Machines in maintenance are never offered on the storefront.
export function rentable(items: CatalogEquipment[]): CatalogEquipment[] {
  return items.filter((eq) => eq.availabilityStatus !== 'maintenance');
}

export function placeLine(t: { address?: string | null; city?: string | null; province?: string | null }): string {
  return [t.address, t.city, t.province].filter(Boolean).join(', ');
}
