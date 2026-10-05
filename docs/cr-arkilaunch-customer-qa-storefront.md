# Change Record

**Title:** Tenant-managed storefront testimonials and landing navigation
**Project:** ArkiLaunch
**Date:** 2026-10-05
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Customer QA package PA, findings #1, #2 and #18; approved storefront frame 144:1386 and owner decisions (PRD-F8).
**Docs touched by this record:** [voice-arkilaunch.md](voice-arkilaunch.md). Index registration is reserved for integration.

---

## 1. Why

The public testimonial read and cards existed, but staff could not enter real quotes. Empty deployed tenants therefore showed no testimonials. Landing cards displayed hourly prices, and signed-out mobile visitors lacked a Cart link.

## 2. What changed

- Migration `0083_testimonials_admin.sql` adds nullable `headline`, preserves the existing tenant isolation policy and forced RLS, and includes headline in the active-tenant public lookup.
- Staff list/create/update/delete live at `/tenants/me/testimonials`, using the branding permission `tenant:manage`, global JWT/permission guards and `withTenantTx`. Missing or foreign IDs return 404. Strict Zod input rejects tenant fields.
- The existing storefront branding page gains a Testimonials section with add, edit, delete confirmation, loading, empty, error and success states.
- Landing testimonials and the `/#testimonials` navigation link appear only when saved rows exist. All rows are shown newest first. Cards use three columns at lg, two at md and one on phones, with optional headline and plain-text quote.
- Avatars are neutral circles with initials derived from authorName and `aria-hidden`. No upload or avatar column is added.
- Landing cards hide prices through `showPrice={false}`. This amends [hourly-rate-cards](cr-arkilaunch-hourly-rate-cards.md) for `/` only: `/equipment`, detail pages, catalog responses and cart pricing retain hourly rates.
- Signed-out mobile navigation links to the existing `/account/cart` route.

This supersedes the testimonial omission in [frontend-storefront-shell](cr-arkilaunch-frontend-storefront-shell.md). Only real tenant-entered endorsements are allowed; no deployed seed is added. Existing local seed rows are retained.

## 3. Business and security rules

Headline is nullable and at most 60 characters. Quote is required, trimmed, 1 to 280 characters; author name is required, trimmed, 1 to 80; author title may be empty and is at most 80. Quote data is rendered as escaped text. Customers cannot access staff management. Tenant context comes from verified identity, never write input.

## 4. Verification

The branch incorporates origin/dev c28edcb, confirmed by a fresh fetch, and retains its equipment-cost and customer-tier changes. Migration 0083 uses journal idx 83 and timestamp 1791158402000; 0081 and 0082 remain reserved for parallel packages. The continuation applied the complete migration journal and anchor seed to the recreated empty local database on port 5441, then added the repository's two-tenant test fixtures. No remote database was touched.

Regression coverage includes staff CRUD, public headline/scoping, cross-tenant read/write rejection, customer permission rejection, strict lengths, landing-only price hiding, null headlines, empty section/navigation, text rendering and signed-out Cart navigation. Browser coverage exercises staff management, anchor navigation, overflow and Cart at 360/375/390/430 and desktop 1440. Final run results are recorded in the implementation report.

The testimonial API integration spec passed all three tests. The browser spec passed 14 of 16 cases across desktop and mobile projects: staff CRUD at every required width, empty section/navigation and customer write rejection passed. Both remaining cases fail because the existing customer-only account layout redirects signed-out Cart clicks to `/login?redirect=%2Faccount%2Fcart` at every phone width. The Cart link is visible and at least 44px high, but guest access is not complete. Account/cart files belong to the parallel package and were not changed here; integration remains blocked until that destination is resolved. Landing price hiding and catalog hourly prices passed in the final browser run.

## 5. Pre-merge gates

Tenant-isolation, migration-RLS and restraint source reviews passed. No required control was cut. Lint, typecheck and both web/API builds passed. Broad test runs initially encountered missing local fixtures and resource-related timeouts. The lower-concurrency rerun passed all 1,277 tests: 479 web, 353 API, 66 database, 296 shared, 17 document-intelligence, 20 weather and 46 job tests. The signed-out Cart browser failures remain a review-readiness blocker.

Framework shapes were checked against the installed versions and official [Drizzle update documentation](https://orm.drizzle.team/docs/update), [React state documentation](https://react.dev/reference/react/useState) and [TanStack Router navigation documentation](https://tanstack.com/router/latest/docs/framework/react/guide/navigation).
