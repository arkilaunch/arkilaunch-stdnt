# Change Record: Platform SaaS landing and rental partners

**Date:** 2026-10-04
**Status:** Applied
**Trigger:** Owner approved the SaaS landing and partner presentation plan.
**Traceability:** PRD-F7 company onboarding; PRD-F8 storefront discovery; S1 public landing.
**Docs touched:** DSD sections 4.1/9, SDD section 2, index; DESIGN.md materialization.

## Decisions

- The platform homepage sells rental management software to rental companies. Registration is primary; contractor discovery is secondary.
- Scroll reveals enter once when the hero screenshot or content section reaches the viewport. The hero uses a restrained scale and perspective entrance; cards use a short stagger. Browsers without IntersectionObserver and users requesting reduced motion see all content immediately. The former onboarding carousel is replaced by in-flow visible steps.
- Preserve existing palette, Inter typography and shape tokens. Use the actual inventory interface, captured with sample responses, as the hero visual.
- Show product workflow, rental partners and directory, setup steps, address prefill and closing registration action. Mobile navigation is an accessible disclosure; onboarding steps remain visible without carousel interaction.
- Almara (`almara`, confirmed in the anchor seed) is the pilot partner. Resolve it independently of directory filters from the active public catalog; exact slug matching prevents similarly named companies from being featured. Hide unavailable featured records. No endorsement, result or testimonial is invented.
- Preserve searchable active-company discovery and tenant storefront navigation. Logo failures use initials; storefront actions remain visible on touch.
- Make existing help and draft legal routes accessible on the platform host. Platform terms do not inherit tenant rental-weather conditions. These resource pages retain noindex.
- Serve platform-homepage SEO through the Worker and preserve its client title. Index only the configured platform host's root, strip query strings from its canonical URL, and preserve tenant SEO and private noindex behavior. The platform sitemap contains only the indexed homepage.
- No backend, schema, RLS, pricing, billing or approval behavior changes.

## Assets and maintenance

`scripts/capture-platform-preview.mjs` opens the actual inventory route with intercepted sample API responses, then exports a full-height, six-category 1440px capture and responsive 800px WebP using Python Pillow. This lets the landing page laptop screen scroll through the sample fleet. Run with the local Vite server available. No production records or authentication credentials are used. The page labels the screenshot as sample data. ArkiLaunch owns the app screenshot; no external photography is included.

Featured partner selection stays in a small frontend configuration. Company branding and membership always come from the live catalog. New featured companies require an editorial entry; all active companies already appear in the directory.

## Verification

- Typecheck passed (browser and Worker).
- Targeted web unit tests: 24 passed. Platform browser tests: 4 passed, including layout/image checks at 360, 390, 768, 1024 and 1440px. A follow-up browser check passed for private metadata after client navigation.
- Full web unit suite: 74 files, 471 tests passed. Shared title, host and public-route behavior covered by the existing suite. Unrelated API and money-path browser suites were not run for this frontend change.
- Production web build passed. Local Worker served-HTML checks passed for homepage canonical, social and structured metadata and private/resource-route noindex (`scripts/verify-platform-seo.mjs`).
- Desktop and phone screenshots reviewed; captures saved in `artifacts/platform-landing/`. The existing large-bundle build warning remains.
- Browser coverage includes five widths, image loading, navigation, directory filters, independent featured selection, resource routes, and catalog failure/retry. Unit coverage includes inactive/mismatched partner records, failed logos, address prefill, metadata and escaping.

## References

- [React useState](https://react.dev/reference/react/useState): state and disclosure behavior.
- TanStack Query uses the installed 5.90.21 `useQuery` API and existing repository query pattern. The live documentation endpoint timed out during verification; package types and runtime regression checks confirmed these calls.
- [Cloudflare HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/): streamed HTML head rewriting.

## Rollback

Revert this change's landing, resource-route, metadata, sitemap and asset changes together. No database rollback is needed.
