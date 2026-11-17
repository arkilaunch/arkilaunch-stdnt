# Change Record

**Title:** Tenant storefront home: load, error and empty states, one clear action, How renting works
**Project:** ArkiLaunch
**Date:** 2026-10-16
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Stakeholder panel feedback, QA §3 User Experience & Account Onboarding, "Landing Page Optimization" (Mr. Violeta)
**Docs touched:** [DSD](dsd-arkilaunch.md) §5 (new storefront-home paragraph, hand-materialized into `DESIGN.md`); [index.md](index.md) §2

---

## 1. Summary

The panel asked for a better design, layout and experience on the main landing page. For a customer, that page is the tenant storefront home, `/` on a tenant host. The platform marketing page on the bare domain is unchanged.

The storefront home had these problems:

- It showed `No equipment matches ""` while loading, after an API error, and when the fleet was empty.
- The default tagline flashed before the tenant's own tagline loaded.
- The right half of the hero stayed empty when there was no image.
- "Rent now" and "View fleet" both went to the same place.
- The search box only filtered the six-card preview.
- The footer year was hardcoded as 2026, and a column labelled "Use cases" held navigation links.

## 2. Approved behaviour changes

- **States.** The equipment preview shows:
  - a skeleton while loading;
  - "The equipment list could not be loaded." with Retry on error;
  - "No machines listed yet" when the fleet is empty.

  Only a real search miss reads "No equipment matches".
- **Hero.** The hero waits behind a skeleton until the tenant and fleet load.
  - The subhead is the first sentence of the tenant's About text, when set.
  - Without a hero image or fleet photo, the hero is one column.
- **Actions.** One primary "Browse equipment" button. "Create account" appears only when the visitor is signed out.
- **Search.** Pressing Enter in the search, or choosing "See all N machines", opens `/equipment?q=…` with the filter already applied. `/equipment` accepts `q` (up to 100 characters).
- **How renting works.** A new section with four numbered steps matches the flow from the deferred-verification and rental-agreement CRs:
  1. Browse and see prices
  2. Request a quote
  3. Verify your company
  4. Sign and pay

  It reuses the platform onboarding-step style and its reduced-motion-safe reveal.
- **Footer.** The year comes from the clock, and the "Use cases" column is renamed "Rent".

## 3. Data and API

None.

## 4. Not in scope

- Tenant-editable subhead or section copy.
- Category tiles, FAQ and trust badges.
- Platform landing (S1).

## 5. Verification

| Check | Result |
|---|---|
| `apps/web` `storefront.test.tsx` | Public prices; How renting works present; search navigates to `/equipment` with `q=hoe` and seeds the filter; fleet error shows retry and no search miss; empty fleet shows the empty state |
| `pnpm -r typecheck`, `pnpm -r lint` | Clean |
