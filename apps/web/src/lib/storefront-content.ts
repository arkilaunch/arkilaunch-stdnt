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

export const areasLine = (areas: string[]) => `Serving ${areas.join(', ')}`;

export function placeLine(t: { address?: string | null; city?: string | null; province?: string | null }): string {
  return [t.address, t.city, t.province].filter(Boolean).join(', ');
}

// Profile links shown in the footer and marked up as sameAs: Facebook first, then the tenant's own links, labeled
// by site. Only https links ever reach an href.
const PROFILE_LABELS: [RegExp, string][] = [
  [/(^|\.)(facebook|fb)\.com$/, 'Facebook'],
  [/(^|\.)(google\.com|g\.page|goo\.gl|maps\.app\.goo\.gl)$/, 'Google'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)(x|twitter)\.com$/, 'X'],
];

export interface ProfileLink {
  label: string;
  href: string;
}

export function profileLinks(t: { facebookUrl?: string | null; sameAs?: string[] | null | undefined }): ProfileLink[] {
  const seen = new Set<string>();
  const out: ProfileLink[] = [];
  for (const href of [t.facebookUrl, ...(t.sameAs ?? [])]) {
    if (!href || !/^https:\/\//i.test(href) || seen.has(href)) continue;
    seen.add(href);
    let host = '';
    try {
      host = new URL(href).hostname.toLowerCase();
    } catch {
      continue;
    }
    out.push({ label: PROFILE_LABELS.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, ''), href });
  }
  return out;
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Mon–Sat, 07:00–17:00" from tenant_calendar's hours (0 = Sunday).
export function hoursLine(h: { openTime: string; closeTime: string; openDays: number[] } | null | undefined): string | null {
  if (!h || h.openDays.length === 0) return null;
  const days = [...new Set(h.openDays)].sort((a, b) => a - b);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  const dayText = contiguous && days.length > 2 ? `${DAY_SHORT[days[0]!]}–${DAY_SHORT[days.at(-1)!]}` : days.map((d) => DAY_SHORT[d]).join(', ');
  return `${dayText}, ${h.openTime}–${h.closeTime}`;
}
