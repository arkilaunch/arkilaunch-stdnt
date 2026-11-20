import type { CatalogEquipment, CatalogTenant } from '@arkilaunch/shared';
import { formatPeso } from './format.js';

// Pure (no DOM, no Vite): the edge Worker imports this too, so pages paint the same before and after hydration.

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function onPrimaryFor(hex: string): '#000000' | '#ffffff' {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

// --font-mono is never swapped: numbers stay mono.
const PLEX_STACK = "'IBM Plex Sans', Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif";

export type TenantBrand = Pick<CatalogTenant, 'primaryColor' | 'font'>;

export const BRAND_VARS = [
  '--yb-color-primary',
  '--yb-color-primary-hover',
  '--yb-color-on-primary',
  '--font-sans',
] as const;

export function brandVars(t: TenantBrand | null | undefined): Partial<Record<(typeof BRAND_VARS)[number], string>> {
  const vars: Partial<Record<(typeof BRAND_VARS)[number], string>> = {};
  if (t?.primaryColor) {
    vars['--yb-color-primary'] = t.primaryColor;
    vars['--yb-color-primary-hover'] = `color-mix(in srgb, ${t.primaryColor} 85%, black)`;
    vars['--yb-color-on-primary'] = onPrimaryFor(t.primaryColor);
  }
  if (t?.font === 'plex') vars['--font-sans'] = PLEX_STACK;
  return vars;
}

type TitleTenant = Pick<CatalogTenant, 'name' | 'city'> & { seoTitle?: string | null | undefined };

// The home title carries the city, so a local search ("equipment rental Quezon City") matches the brand page.
// The tenant's own SEO title wins when they wrote one.
export function homeTitle(t: TitleTenant): string {
  if (t.seoTitle) return t.seoTitle;
  return t.city ? `${t.name} | Equipment rental in ${t.city}` : t.name;
}

const PAGE_TITLES: Record<string, (t: TitleTenant) => string> = {
  '/equipment': (t) => (t.city ? `Equipment for rent in ${t.city}` : 'Equipment for rent'),
  '/contact': () => 'Contact',
  '/help': () => 'Help center',
  '/terms': () => 'Terms of service',
  '/privacy': () => 'Privacy policy',
};

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/$/, '') : path);
const DETAIL_PATH = /^\/equipment\/[^/]+$/;

export function pageTitle(pathname: string, t: TitleTenant, detail?: string): string | null {
  const path = trimSlash(pathname);
  if (DETAIL_PATH.test(path)) return detail ? `${detail} | ${t.name}` : null;
  if (path === '/') return homeTitle(t);
  const page = PAGE_TITLES[path];
  return page ? `${page(t)} | ${t.name}` : t.name;
}

const INDEXABLE = ['/', '/equipment', '/contact', '/help', '/terms', '/privacy'];

export function isIndexable(pathname: string): boolean {
  const path = trimSlash(pathname);
  return INDEXABLE.includes(path) || DETAIL_PATH.test(path);
}

// Every path the SPA router serves; anything else is a real 404 at the edge. known-paths.test.ts guards the drift.
const KNOWN = new Set([...INDEXABLE, '/login', '/signup', '/register', '/register/company', '/register/pending', '/activate', '/reset-password']);
const KNOWN_PREFIX = /^\/(app|account|field|admin)(\/|$)/;

export function isKnownPath(pathname: string): boolean {
  const path = trimSlash(pathname);
  return KNOWN.has(path) || DETAIL_PATH.test(path) || KNOWN_PREFIX.test(path);
}

// Tenant-written strings go into attributes and a <script>: escape both.
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// `<` escaped so no tenant string can close the script element.
export function jsonLdScript(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export interface PageDetail {
  title: string;
  description: string;
  imageUrl: string | null;
  jsonLd?: Record<string, unknown>[];
}

const clip = (s: string, max = 160) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

// An equipment page's head: a local, priced description, and markup that claims no more than the page shows.
export function equipmentPage(eq: CatalogEquipment, t: CatalogTenant, origin: string): PageDetail {
  const rate = eq.rateValue ?? null;
  const url = `${origin}/equipment/${encodeURIComponent(eq.id)}`;
  const jsonLd: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: 'Equipment', item: `${origin}/equipment` },
        { '@type': 'ListItem', position: 3, name: eq.model, item: url },
      ],
    },
  ];
  // No published rate, no Offer: the page shows "Price on request".
  if (rate != null) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: eq.model,
      category: eq.equipmentTypeName,
      url,
      ...(eq.photoUri ? { image: eq.photoUri } : {}),
      offers: {
        '@type': 'Offer',
        url,
        price: rate,
        priceCurrency: 'PHP',
        priceSpecification: { '@type': 'UnitPriceSpecification', price: rate, priceCurrency: 'PHP', unitCode: 'HUR' },
        businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
        // No availability: the storefront shows no status labels (feat(catalog) 7eee3a4), so neither does the markup.
        seller: { '@id': `${origin}/#business` },
      },
    });
  }
  const where = t.city ? ` in ${t.city}` : '';
  const price = rate != null ? ` (${formatPeso(rate)}/hour)` : '';
  return {
    title: eq.model,
    description: clip(`${eq.model} ${eq.equipmentTypeName.toLowerCase()} for rent${where} from ${t.name}${price}.`),
    imageUrl: eq.photoUri ?? null,
    jsonLd,
  };
}

// tenant_calendar's open_days: 0 = Sunday.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The home page's entity: the rental yard as a LocalBusiness, and the storefront it publishes.
function homeGraph(t: CatalogTenant, origin: string, description: string): Record<string, unknown> {
  const home = `${origin}/`;
  const business: Record<string, unknown> = { '@type': t.businessType ?? 'LocalBusiness', '@id': `${origin}/#business`, name: t.name, url: home, description };
  if (t.logoUrl ?? t.iconUrl) business.logo = t.logoUrl ?? t.iconUrl;
  if (t.heroUrl ?? t.logoUrl) business.image = t.heroUrl ?? t.logoUrl;
  if (t.phone) business.telephone = t.phone;
  if (t.contactEmail) business.email = t.contactEmail;
  if (t.address || t.city || t.province) {
    business.address = {
      '@type': 'PostalAddress',
      ...(t.address ? { streetAddress: t.address } : {}),
      ...(t.city ? { addressLocality: t.city } : {}),
      ...(t.province ? { addressRegion: t.province } : {}),
      addressCountry: 'PH',
    };
  }
  const sameAs = [...new Set([t.facebookUrl, ...(t.sameAs ?? [])].filter((u): u is string => Boolean(u)))];
  if (sameAs.length) business.sameAs = sameAs;
  if (t.serviceAreas?.length) business.areaServed = t.serviceAreas;
  if (t.location) business.geo = { '@type': 'GeoCoordinates', latitude: t.location.lat, longitude: t.location.lng };
  if (t.hours?.openDays.length) {
    business.openingHoursSpecification = {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [...t.hours.openDays].sort().map((d) => DAY_NAMES[d]),
      opens: t.hours.openTime,
      closes: t.hours.closeTime,
    };
  }
  const website = { '@type': 'WebSite', '@id': `${origin}/#website`, name: t.name, url: home, inLanguage: 'en-PH', publisher: { '@id': `${origin}/#business` } };
  return { '@context': 'https://schema.org', '@graph': [business, website] };
}

// Only the tenant's own row feeds these tags.
export function headTags(t: CatalogTenant, url: URL, detail?: PageDetail | null): string {
  const path = trimSlash(url.pathname);
  const canonical = `${url.origin}${path === '/' ? '/' : path}`;
  const title = pageTitle(path, t, detail?.title) ?? t.name;
  const description =
    detail?.description ?? (path === '/' ? t.seoDescription : null) ?? t.tagline ?? t.about?.slice(0, 160) ?? `Heavy equipment rentals from ${t.name}.`;
  const image = detail?.imageUrl ?? t.heroUrl ?? t.iconUrl ?? t.logoUrl;
  const icon = t.iconUrl ?? t.logoUrl;
  const theme = t.headerColor ?? t.primaryColor;
  const meta = (key: 'name' | 'property', name: string, content: string) =>
    `<meta ${key}="${name}" content="${attr(content)}" />`;
  const tags = [
    meta('name', 'description', description),
    `<link rel="canonical" href="${attr(canonical)}" />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', t.name),
    meta('property', 'og:locale', 'en_PH'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', canonical),
    meta('name', 'twitter:card', t.heroUrl && !detail?.imageUrl ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
  ];
  if (image) tags.push(meta('property', 'og:image', image), meta('name', 'twitter:image', image));
  if (icon) tags.push(`<link rel="icon" href="${attr(icon)}" />`, `<link rel="apple-touch-icon" href="${attr(icon)}" />`);
  if (theme) tags.push(meta('name', 'theme-color', theme));
  if (path === '/') tags.push(jsonLdScript(homeGraph(t, url.origin, description)));
  for (const ld of detail?.jsonLd ?? []) tags.push(jsonLdScript(ld));
  return tags.join('\n    ');
}

// Storefront public pages are open to search, answer and training crawlers (CLR §5, CR tenant-seo-geo); signed-in
// areas and token links are not. Sign-in pages stay crawlable so their noindex is seen.
const CRAWLERS = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', '*'];
const PRIVATE_PATHS = ['/app/', '/account/', '/field/', '/admin/', '/platform/', '/activate', '/reset-password'];

export function tenantRobotsTxt(origin: string): string {
  const agents = CRAWLERS.map((a) => `User-agent: ${a}`).join('\n');
  const rules = ['Allow: /', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`)].join('\n');
  return `${agents}\n${rules}\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export interface SitemapEntry {
  path: string;
  lastmod?: string | null;
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const latest = (dates: (string | null | undefined)[]) => dates.filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;

// lastmod: the tenant's content change for its own pages; the newest listing for the catalog; each unit's own.
export function tenantSitemapEntries(
  t: Pick<CatalogTenant, 'contentUpdatedAt'> | null,
  items: Pick<CatalogEquipment, 'id' | 'updatedAt'>[],
): SitemapEntry[] {
  const site = t?.contentUpdatedAt ?? null;
  const pages = INDEXABLE.map((path) => ({
    path,
    lastmod: day(path === '/equipment' ? latest([site, ...items.map((i) => i.updatedAt)]) : path === '/' || path === '/contact' ? site : null),
  }));
  return [...pages, ...items.map((i) => ({ path: `/equipment/${encodeURIComponent(i.id)}`, lastmod: day(i.updatedAt) }))];
}

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const urls = entries
    .map(({ path, lastmod }) => `  <url><loc>${attr(`${origin}${path}`)}</loc>${lastmod ? `<lastmod>${attr(lastmod)}</lastmod>` : ''}</url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
// QA 30: the installed (Add to home screen) app. The platform icons always ship so the browser can install; a tenant's
// square icon leads when it has one. Name and color follow the tenant, so the home screen reads as that yard's app.
export const PLATFORM_ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

export function webManifest(t: Pick<CatalogTenant, 'name' | 'iconUrl' | 'headerColor' | 'primaryColor'> | null) {
  const name = t?.name ?? 'ArkiLaunch';
  return {
    name,
    short_name: name.length > 12 ? name.split(/\s+/)[0]!.slice(0, 12) : name,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F2EB',
    theme_color: t?.headerColor ?? t?.primaryColor ?? '#10151B',
    icons: [...(t?.iconUrl ? [{ src: t.iconUrl, sizes: 'any', purpose: 'any' }] : []), ...PLATFORM_ICONS],
  };
}
