import type { CatalogEquipment, CatalogEquipmentListResponse, CatalogTenant } from '@arkilaunch/shared';
import { formatPeso } from './format.js';
import {
  DEFAULT_SUBHEAD,
  DEFAULT_TAGLINE,
  HOME_EYEBROW_SUFFIX,
  HOW_IT_WORKS,
  PREVIEW_COUNT,
  PRICE_ON_REQUEST,
  GUEST_CATALOG_TITLE,
  areasLine,
  firstSentence,
  hoursLine,
  placeLine,
  profileLinks,
  rentable,
} from './storefront-content.js';

// Pure (no DOM, no Vite). The edge Worker writes this plain HTML into #root so crawlers that run no JavaScript read
// the page; React's createRoot replaces it on mount. It is a subset of what the React page shows (the parity test in
// routes/storefront-parity.test.tsx guards that) -- never extra, hidden, or different copy.

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const e = escapeText;
const detailHref = (id: string) => `/equipment/${encodeURIComponent(id)}`;
const rateLabel = (rate: number | null | undefined) => (rate != null ? `${formatPeso(rate)} / hour` : PRICE_ON_REQUEST);

export type SnapshotPage =
  | { kind: 'home'; tenant: CatalogTenant; equipment: CatalogEquipment[] }
  | { kind: 'equipment'; tenant: CatalogTenant; equipment: CatalogEquipment[] }
  | { kind: 'detail'; tenant: CatalogTenant; eq: CatalogEquipment }
  | { kind: 'contact'; tenant: CatalogTenant };

function nav(t: CatalogTenant): string {
  // The same labels as the storefront footer links (routes/_public.tsx).
  return `<header><p>${e(t.name)}</p><nav aria-label="Main"><a href="/equipment">Browse equipment</a> <a href="/contact">Contact</a> <a href="/help">Help center</a></nav></header>`;
}

// The same footer content the storefront shows: the name and its profile links.
function footer(t: CatalogTenant): string {
  const links = profileLinks(t).map((p) => `<li><a href="${e(p.href)}" rel="me noopener noreferrer">${e(p.label)}</a></li>`);
  return `<footer><p>${e(t.name)}</p>${links.length ? `<ul>${links.join('')}</ul>` : ''}</footer>`;
}

function home(t: CatalogTenant, items: CatalogEquipment[]): string {
  const offered = rentable(items);
  const preview = offered.slice(0, PREVIEW_COUNT);
  const cards = preview
    .map((eq) => `<li><h3><a href="${detailHref(eq.id)}">${e(eq.model)}</a></h3><p>${e(eq.equipmentTypeName)}</p></li>`)
    .join('');
  const more = offered.length > PREVIEW_COUNT ? `<p><a href="/equipment">See all ${offered.length} machines</a></p>` : '';
  const steps = HOW_IT_WORKS.map((s) => `<li><h3>${e(s.title)}</h3><p>${e(s.body)}</p></li>`).join('');
  return [
    `<section><p>${e(t.name)} · ${e(HOME_EYEBROW_SUFFIX)}</p>`,
    `<h1>${e(t.tagline || DEFAULT_TAGLINE)}</h1>`,
    `<p>${e(firstSentence(t.about) ?? DEFAULT_SUBHEAD)}</p>`,
    t.serviceAreas?.length ? `<p>${e(areasLine(t.serviceAreas))}</p>` : '',
    `<p><a href="/equipment">Browse equipment</a></p></section>`,
    offered.length ? `<section><h2>Available equipment</h2><ul>${cards}</ul>${more}</section>` : '',
    `<section><h2>How renting works</h2><ol>${steps}</ol></section>`,
  ].join('');
}

function catalog(items: CatalogEquipment[]): string {
  const rows = rentable(items)
    .map((eq) => `<li><h3><a href="${detailHref(eq.id)}">${e(eq.model)}</a></h3><p>${e(eq.equipmentTypeName)}</p><p>${e(rateLabel(eq.rateValue))}</p></li>`)
    .join('');
  return `<h1>${e(GUEST_CATALOG_TITLE)}</h1><ul>${rows}</ul>`;
}

function detail(eq: CatalogEquipment): string {
  const img = eq.photoUri ? `<img src="${e(eq.photoUri)}" alt="${e(`${eq.equipmentTypeName} ${eq.model}`)}">` : '';
  const options = (eq.optionGroups ?? []).length
    ? `<dl>${(eq.optionGroups ?? []).map((g) => `<dt>${e(g.name)}:</dt><dd>${e(g.values.join(' · '))}</dd>`).join('')}</dl>`
    : '';
  return [
    `<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/equipment">Equipment</a></li><li aria-current="page">${e(eq.model)}</li></ol></nav>`,
    img,
    `<h1>${e(eq.model)}</h1><p>${e(eq.equipmentTypeName)}</p><p>${e(rateLabel(eq.rateValue))}</p>`,
    options,
  ].join('');
}

function contact(t: CatalogTenant): string {
  const place = placeLine(t);
  const rows: string[] = [];
  if (place) rows.push(`<dt>Address</dt><dd>${e(place)}</dd>`);
  const hours = hoursLine(t.hours);
  if (hours) rows.push(`<dt>Hours</dt><dd>${e(hours)}</dd>`);
  if (t.serviceAreas?.length) rows.push(`<dt>Areas served</dt><dd>${e(t.serviceAreas.join(', '))}</dd>`);
  if (t.phone) rows.push(`<dt>Phone</dt><dd>${e(t.phone)}</dd>`);
  if (t.contactEmail) rows.push(`<dt>Email</dt><dd><a href="mailto:${e(t.contactEmail)}">${e(t.contactEmail)}</a></dd>`);
  return `<h1>Contact</h1>${t.about ? `<p>${e(t.about)}</p>` : ''}${rows.length ? `<dl>${rows.join('')}</dl>` : ''}`;
}

export function snapshotHtml(p: SnapshotPage): string {
  const body =
    p.kind === 'home' ? home(p.tenant, p.equipment) : p.kind === 'equipment' ? catalog(p.equipment) : p.kind === 'detail' ? detail(p.eq) : contact(p.tenant);
  return `${nav(p.tenant)}<main id="main">${body}</main>${footer(p.tenant)}`;
}

// The data the snapshot was built from, so React's first render has it and paints content, not a skeleton.
export interface CatalogSeed {
  tenant: CatalogTenant;
  equipment?: CatalogEquipmentListResponse;
  detail?: CatalogEquipment;
}

export const SEED_ID = 'catalog-seed';

export function seedScript(seed: CatalogSeed): string {
  return `<script type="application/json" id="${SEED_ID}">${JSON.stringify(seed).replace(/</g, '\\u003c')}</script>`;
}

// llmstxt.org shape: what an answer engine needs to describe and cite this yard.
export function llmsTxt(t: CatalogTenant, origin: string, items: CatalogEquipment[]): string {
  const place = placeLine(t);
  const lines = [`# ${t.name}`, '', `> ${t.tagline || `Heavy equipment rental${t.city ? ` in ${t.city}` : ''}.`}`, ''];
  if (t.about) lines.push(t.about.trim(), '');
  lines.push('## Contact', '');
  if (place) lines.push(`- Address: ${place}`);
  if (t.phone) lines.push(`- Phone: ${t.phone}`);
  if (t.contactEmail) lines.push(`- Email: ${t.contactEmail}`);
  const hours = hoursLine(t.hours);
  if (hours) lines.push(`- Hours: ${hours}`);
  if (t.serviceAreas?.length) lines.push(`- Areas served: ${t.serviceAreas.join(', ')}`);
  for (const p of profileLinks(t)) lines.push(`- ${p.label}: ${p.href}`);
  lines.push(`- Website: ${origin}/`, '', '## Pages', '');
  lines.push(`- [Equipment for rent](${origin}/equipment): the full fleet with published hourly rates`);
  lines.push(`- [Contact](${origin}/contact): address, phone and email`);
  lines.push(`- [How renting works](${origin}/): browse and see prices, request a quote, verify your company once, sign and pay a deposit`);
  const offered = rentable(items);
  if (offered.length) {
    lines.push('', '## Equipment', '');
    for (const eq of offered) lines.push(`- [${eq.model}](${origin}${detailHref(eq.id)}): ${eq.equipmentTypeName}, ${rateLabel(eq.rateValue)}`);
  }
  return `${lines.join('\n')}\n`;
}
