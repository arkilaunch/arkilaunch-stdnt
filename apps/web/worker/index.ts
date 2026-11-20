import type { CatalogEquipment, CatalogTenant } from '@arkilaunch/shared';
import {
  brandVars,
  equipmentPage,
  headTags,
  isIndexable,
  isKnownPath,
  pageTitle,
  sitemapXml,
  tenantRobotsTxt,
  tenantSitemapEntries,
  webManifest,
  type PageDetail,
} from '../src/lib/brand.js';
import { PLATFORM_TITLE, platformHeadTags, sitemapIndexXml } from '../src/lib/platform-brand.js';
import { llmsTxt, seedScript, snapshotHtml, type CatalogSeed, type SnapshotPage } from '../src/lib/snapshot.js';

// Writes the tenant's own head tags into the shared SPA shell; any failure serves the untouched shell.

interface Env {
  ASSETS: Fetcher;
  API_BASE_URL: string;
  PLATFORM_DOMAIN: string;
}

const TIMEOUT_MS = 1500;
const CACHE_SECONDS = 300;
// A definitive "not found" is cached briefly so a crawler sweeping dead URLs doesn't spend the API's public budget.
const MISSING_CACHE_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same label rule as the API's slug check; anything else is not a tenant.
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Not a valid slug, so the platform's cache entries can never collide with a tenant's.
const PLATFORM_SCOPE = '_platform';

function tenantSlug(hostname: string, platformDomain: string): string | null {
  for (const root of ['localhost', platformDomain]) {
    if (!hostname.endsWith(`.${root}`)) continue;
    const label = hostname.slice(0, -root.length - 1);
    return SLUG.test(label) ? label : null;
  }
  return null;
}

// `missing` only on the API's own 404; a timeout, 5xx or 429 is not evidence the page is gone.
type Got<T> = { ok: true; data: T } | { ok: false; missing: boolean };

// The cache key carries the scope (tenant slug), so one tenant's data is never served for another.
async function catalog<T>(env: Env, ctx: ExecutionContext, scope: string, path: string): Promise<Got<T>> {
  const key = new Request(`https://edge-cache.invalid/${scope}${path}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) {
    const body = (await hit.json()) as T | { __missing: true };
    return body && typeof body === 'object' && '__missing' in body ? { ok: false, missing: true } : { ok: true, data: body as T };
  }
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (scope !== PLATFORM_SCOPE) headers['X-Tenant-Slug'] = scope;
    const res = await fetch(`${env.API_BASE_URL}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) {
      const gone = new Response('{"__missing":true}', {
        headers: { 'Cache-Control': `max-age=${MISSING_CACHE_SECONDS}`, 'Content-Type': 'application/json' },
      });
      ctx.waitUntil(cache.put(key, gone));
      return { ok: false, missing: true };
    }
    if (!res.ok) return { ok: false, missing: false };
    const body = await res.text();
    ctx.waitUntil(
      cache.put(key, new Response(body, { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}`, 'Content-Type': 'application/json' } })),
    );
    return { ok: true, data: JSON.parse(body) as T };
  } catch {
    return { ok: false, missing: false };
  }
}

const tenantOf = (env: Env, ctx: ExecutionContext, slug: string) => catalog<CatalogTenant>(env, ctx, slug, '/catalog/tenant');
const equipmentListOf = (env: Env, ctx: ExecutionContext, slug: string) =>
  catalog<{ items: CatalogEquipment[] }>(env, ctx, slug, '/catalog/equipment?limit=100');

// The cached list answers most detail pages without another API call; the detail lookup settles the rest.
async function equipmentOf(env: Env, ctx: ExecutionContext, slug: string, id: string): Promise<Got<CatalogEquipment>> {
  const list = await equipmentListOf(env, ctx, slug);
  const hit = list.ok ? list.data.items.find((eq) => eq.id === id) : undefined;
  return hit ? { ok: true, data: hit } : catalog<CatalogEquipment>(env, ctx, slug, `/catalog/equipment/${id}`);
}

// The SPA shell still renders its own not-found screen; crawlers get the status and a header noindex.
function withStatus(res: Response, status: number): Response {
  const out = new Response(res.body, { status, headers: res.headers });
  if (status === 404) out.headers.set('X-Robots-Tag', 'noindex');
  return out;
}

async function tenantPage(request: Request, env: Env, ctx: ExecutionContext, slug: string): Promise<Response> {
  const url = new URL(request.url);
  const shell = () => env.ASSETS.fetch(new Request(new URL('/', url), request));
  const got = await tenantOf(env, ctx, slug);
  if (!got.ok) return got.missing ? withStatus(await shell(), 404) : shell();
  const tenant = got.data;

  let status = isKnownPath(url.pathname) ? 200 : 404;
  let detail: PageDetail | null = null;
  let unit: CatalogEquipment | null = null;
  const id = /^\/equipment\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (id && !UUID.test(id)) status = 404;
  else if (id) {
    const eq = await equipmentOf(env, ctx, slug, id);
    if (eq.ok) {
      unit = eq.data;
      detail = equipmentPage(eq.data, tenant, url.origin);
    }
    else if (eq.missing) status = 404;
  }

  const style = Object.entries(brandVars(tenant))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

  let rewriter = new HTMLRewriter()
    .on('title', { element: (e) => void e.setInnerContent(pageTitle(url.pathname, tenant, detail?.title) ?? tenant.name) })
    .on('head', { element: (e) => void e.append(headTags(tenant, url, detail), { html: true }) });
  if (style) rewriter = rewriter.on('html', { element: (e) => void e.setAttribute('style', style) });
  // The shell's platform theme color and touch icon come first in the head, so they would win: drop the ones the
  // tenant replaces (the appended tenant tags are not matched by these selectors).
  if (tenant.headerColor ?? tenant.primaryColor) rewriter = rewriter.on('meta[name="theme-color"]', { element: (e) => void e.remove() });
  if (tenant.iconUrl ?? tenant.logoUrl) rewriter = rewriter.on('link[rel="apple-touch-icon"]', { element: (e) => void e.remove() });
  // A transient lookup failure keeps today's behavior (indexable); only a definitive 404 stays noindex.
  if (status === 200 && isIndexable(url.pathname)) {
    rewriter = rewriter.on('meta[name="robots"]', { element: (e) => void e.setAttribute('content', 'index, follow') });
  }
  if (tenant.font === 'plex') {
    rewriter = rewriter.on('link[rel="preload"][href="/fonts/inter-variable-latin.woff2"]', {
      element: (e) => void e.setAttribute('href', '/fonts/ibm-plex-sans-variable.woff2'),
    });
  }
  // Crawlers that run no JavaScript read the body too: the same content the React page renders, built from the same data.
  const snap = status === 200 ? await snapshotFor(env, ctx, slug, url.pathname, tenant, unit) : null;
  if (snap) {
    rewriter = rewriter
      .on('div#root', { element: (e) => void e.setInnerContent(snapshotHtml(snap.page), { html: true }) })
      .on('head', { element: (e) => void e.append(seedScript(snap.seed), { html: true }) });
  }
  const page = rewriter.transform(await shell());
  return status === 200 ? page : withStatus(page, status);
}

const trim = (p: string) => (p.length > 1 ? p.replace(/\/$/, '') : p);

async function snapshotFor(
  env: Env,
  ctx: ExecutionContext,
  slug: string,
  pathname: string,
  tenant: CatalogTenant,
  unit: CatalogEquipment | null,
): Promise<{ page: SnapshotPage; seed: CatalogSeed } | null> {
  const path = trim(pathname);
  if (path === '/contact') return { page: { kind: 'contact', tenant }, seed: { tenant } };
  if (unit) return { page: { kind: 'detail', tenant, eq: unit }, seed: { tenant, detail: unit } };
  if (path !== '/' && path !== '/equipment') return null;
  const list = await equipmentListOf(env, ctx, slug);
  if (!list.ok) return null;
  const items = list.data.items;
  return { page: { kind: path === '/' ? 'home' : 'equipment', tenant, equipment: items }, seed: { tenant, equipment: list.data } };
}

async function tenantLlms(env: Env, ctx: ExecutionContext, slug: string, origin: string): Promise<Response> {
  const [tenant, list] = await Promise.all([tenantOf(env, ctx, slug), equipmentListOf(env, ctx, slug)]);
  if (!tenant.ok) return new Response('Not found', { status: tenant.missing ? 404 : 503 });
  return new Response(llmsTxt(tenant.data, origin, list.ok ? list.data.items : []), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': `max-age=${CACHE_SECONDS}` },
  });
}

async function tenantSitemap(env: Env, ctx: ExecutionContext, slug: string, origin: string): Promise<Response> {
  const [tenant, list] = await Promise.all([tenantOf(env, ctx, slug), equipmentListOf(env, ctx, slug)]);
  if (!tenant.ok) {
    return tenant.missing
      ? new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } })
      : new Response('Try again shortly', { status: 503, headers: { 'Retry-After': '60' } });
  }
  // ponytail: first 100 units (the API's page cap); page through if a tenant lists more.
  const items = list.ok ? list.data.items : [];
  return new Response(sitemapXml(origin, tenantSitemapEntries(tenant.data, items)), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

// Every active storefront's sitemap, so finding the platform finds its tenants.
async function platformSitemap(env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const locs = [`${url.origin}/sitemap-pages.xml`];
  const PAGE = 100;
  for (let offset = 0, total = Infinity; offset < total && offset < PAGE * 20; offset += PAGE) {
    const got = await catalog<{ items: { slug: string }[]; total: number }>(env, ctx, PLATFORM_SCOPE, `/catalog/tenants?limit=${PAGE}&offset=${offset}`);
    if (!got.ok) break;
    total = got.data.total;
    for (const t of got.data.items) if (SLUG.test(t.slug)) locs.push(`${url.protocol}//${t.slug}.${url.host}/sitemap.xml`);
    if (got.data.items.length < PAGE) break;
  }
  return new Response(sitemapIndexXml(locs), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const slug = tenantSlug(url.hostname, env.PLATFORM_DOMAIN);
    if (!slug) {
      if (url.pathname === '/sitemap.xml') return platformSitemap(env, ctx, url);
      const assets = await env.ASSETS.fetch(request);
      if (url.hostname !== env.PLATFORM_DOMAIN || url.pathname !== '/' || !assets.headers.get('Content-Type')?.includes('text/html')) return assets;
      return new HTMLRewriter()
        .on('title', { element: (e) => void e.setInnerContent(PLATFORM_TITLE) })
        .on('head', { element: (e) => void e.append(platformHeadTags(url.origin), { html: true }) })
        .on('meta[name="robots"]', { element: (e) => void e.setAttribute('content', 'index, follow') })
        .transform(assets);
    }

    if (url.pathname === '/robots.txt') {
      return new Response(tenantRobotsTxt(url.origin), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname === '/sitemap.xml') return tenantSitemap(env, ctx, slug, url.origin);
    if (url.pathname === '/llms.txt') return tenantLlms(env, ctx, slug, url.origin);
    // The tenant's installable app: its name and colors on the home screen; the static platform manifest otherwise.
    if (url.pathname === '/manifest.webmanifest') {
      const tenant = await tenantOf(env, ctx, slug);
      if (!tenant.ok) return env.ASSETS.fetch(request);
      return new Response(JSON.stringify(webManifest(tenant.data)), {
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': `max-age=${CACHE_SECONDS}` },
      });
    }
    if (url.pathname === '/favicon.ico') {
      const tenant = await tenantOf(env, ctx, slug);
      const icon = tenant.ok ? (tenant.data.iconUrl ?? tenant.data.logoUrl) : null;
      return icon ? Response.redirect(icon, 302) : env.ASSETS.fetch(request);
    }
    if (/\.[a-z0-9]+$/i.test(url.pathname)) {
      // The SPA fallback answers a missing file with the HTML shell; for a file URL that is a 404, not a page.
      const res = await env.ASSETS.fetch(request);
      const shellForFile = res.headers.get('Content-Type')?.includes('text/html') && !/\.html?$/i.test(url.pathname);
      return shellForFile ? withStatus(res, 404) : res;
    }
    return tenantPage(request, env, ctx, slug);
  },
} satisfies ExportedHandler<Env>;
