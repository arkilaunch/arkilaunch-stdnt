# Change Record

**Title:** Tenant SEO / GEO / AI-answer visibility: crawler policy, real 404s, structured data, edge body snapshot, tenant-editable SEO fields and FAQs
**Project:** ArkiLaunch
**Date:** 2026-11-20
**Version:** 0.1
**Status:** `In Progress`; per-phase status in §3
**Trigger doc:** user request 2026-11-20 ("Optimize the SEO, GEO, AISO, AESO of this system. Ensure that when we search in Google our tenants, such as Almara will always come first in Google Search engine and in AI generation citation.") and the follow-up decisions in §2.
**Docs touched by this record:** [build-arkilaunch.md](build-arkilaunch.md) §5.2 (+ `AGENTS.md`), [clr-arkilaunch.md](clr-arkilaunch.md) §5, [sdd-arkilaunch.md](sdd-arkilaunch.md) §6, [index.md](index.md) §2. Later phases add the SDD data model, DSD storefront/console paragraphs (+ `DESIGN.md`) and a Search Console runbook.

---

## 1. Why

Each storefront (`{slug}.arkilaunch.app`) already gets its own head at the edge ([cr-arkilaunch-tenant-brand-kit.md](cr-arkilaunch-tenant-brand-kit.md)). Several things still held back Google and AI-assistant visibility:

- The page bodies are client-rendered, so crawlers that don't run JavaScript get an empty page.
- Listings had no `<a>` links.
- Unknown URLs answered 200 and were indexable (soft 404s).
- Training crawlers were blocked "pending CLR".
- There was no local-business or offer markup, and tenants could not tune their own search presence.

No code can guarantee a #1 rank. The goal is to make each tenant the most authoritative, machine-readable source for its own brand queries, and as eligible as possible for local ones. Local-pack rank depends mostly on the tenant's Google Business Profile and reviews. Those are off-site, and the tenant handles them using in-app guidance (P5).

## 2. Decisions (user, 2026-11-20)

1. Targets are brand queries ("Almara Construction") and local queries ("excavator rental Quezon City").
2. The canonical home stays the subdomain. Custom domains remain out of scope.
3. AI training crawlers (GPTBot, ClaudeBot, Google-Extended) are allowed on tenant storefront public pages only. The platform host and all authenticated or token routes stay disallowed. This is recorded in CLR §5.
4. Crawlers that don't run JS get an edge-rendered HTML snapshot of the visible content. There is no SSR migration and no new dependency.
5. Tenants can edit their SEO title and description, local business info and profile links (`sameAs`).
6. Tenants can edit their own FAQ.
7. Off-site work (GBP, Search Console, Bing, reviews) belongs to the tenant, with in-app guidance.
8. Also in scope: a platform sitemap index, a per-tenant `llms.txt`, real 404s and sitemap `lastmod`.

Two design choices made while building:

- Sign-in pages (`/login`, `/signup`, `/register*`) stay crawlable with `noindex`. Disallowing them would hide the `noindex`, and they could then show up as URL-only results.
- Offer markup carries no `availability`. The storefront deliberately shows no status labels (commit 7eee3a4), and the markup claims no more than the page shows.

## 3. Phases

| Phase | Scope | Status |
|---|---|---|
| P1 | Tenant `robots.txt` builder (crawler decision); real 404s at the edge; `og:locale` and Twitter tags; home LocalBusiness + WebSite `@graph`; equipment BreadcrumbList + Product/Offer; titles and descriptions that carry the city and rate; listing `<a>` links; visible breadcrumb; branded not-found page; platform sitemap index | Built (branch `feat/tenant-seo-geo-p1`) |
| P2 | Edge HTML snapshot inside `#root`, a query-cache seed (no flash), `/llms.txt` | Built (branch `feat/tenant-seo-geo-p1`) |
| P3 | Tenant SEO fields (migration 0097, `/tenants/{me,:id}/seo`), published hours, LocalBusiness enrichment, sitemap `lastmod` | Built (branch `feat/tenant-seo-geo-p1`); DB-backed specs run in CI |
| P4 | `tenant_faqs` (RLS), editor, home FAQ section, FAQPage markup | Not started |
| P5 | Owner checklist, `docs/runbook-search-console.md`, Almara content entered through the UI | Not started |

## 4. P1 detail

- `apps/web/src/lib/brand.ts`:
  - `homeTitle` / `pageTitle(path, tenant, detail?)`.
  - `isKnownPath`.
  - `equipmentPage` (description plus JSON-LD).
  - `jsonLdScript`.
  - `tenantRobotsTxt` (replaces `robotsFor`).
  - `sitemapXml(origin, entries)` with optional `lastmod`, plus `tenantSitemapEntries`.
- `apps/web/src/lib/platform-brand.ts`: `sitemapIndexXml`.
- `apps/web/worker/index.ts`:
  - `catalog()` reports a definitive 404 (cached for 60 s) separately from a transient failure. Only the former produces a 404.
  - 404 responses carry `X-Robots-Tag: noindex`.
  - Detail pages are looked up from the cached list first. This saves API calls under the public throttle.
  - The platform `/sitemap.xml` is an index of `sitemap-pages.xml` (renamed from `public/sitemap.xml`) plus every active tenant's sitemap.
- `apps/web/public/robots.txt`: the platform host also disallows `/admin/`.
- SPA:
  - Listing names are `<Link>`s.
  - The detail page has a visible breadcrumb and treats an API 400 (malformed id) as not found.
  - The root route has a `notFoundComponent`.

## 4b. P2 detail

- `apps/web/src/lib/storefront-content.ts`: one source for the storefront strings (How renting works, default tagline and subhead, guest catalog heading, `firstSentence`, `rentable`, `placeLine`). `routes/index.tsx`, `routes/equipment.tsx` and `routes/contact.tsx` read it.
- `apps/web/src/lib/snapshot.ts`: `snapshotHtml` (home, catalog, detail, contact; every tenant string escaped; only https links), `seedScript`, `llmsTxt`.
- `apps/web/src/lib/catalog-seed.ts`: `applyCatalogSeed`, called in `main.tsx` before React mounts.
- Worker: writes the snapshot and seed on the four pages when the page exists; serves `/llms.txt`.
- The snapshot is a subset of what the React page shows. `routes/storefront-parity.test.tsx` fails if any snapshot heading, link or value is missing from the rendered page (it caught the guest catalog heading during the build).

## 5. Compliance

- Only the tenant's own public catalog row feeds the markup. No customer data appears.
- The training-crawler allow is a policy decision. It is recorded in CLR §5 and can be reversed in one builder.
- No new sub-processor, no analytics script and no new dependency.

## 6. Verification (P1)

- `apps/web/src/lib/brand.test.ts`: titles, the `@graph`, Product/Offer only when a rate exists, breadcrumbs, escaping, robots rules, `isKnownPath`, sitemap.
- `platform-brand.test.ts`: sitemap index escaping.
- `known-paths.test.ts`: every router path passes `isKnownPath`.
- `routes/storefront.test.tsx`: listing link, breadcrumb, 400 treated as not found, unrouted path.
- `scripts/verify-tenant-seo.mjs`, run against `wrangler dev`: statuses, robots and sitemap.

## 7. Rollback

Revert the P1 commit. There is no data change.
