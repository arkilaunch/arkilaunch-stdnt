# Change Record: Platform landing laptop preview

**Date:** 2026-10-04
**Status:** Superseded by `cr-arkilaunch-platform-landing-dashboard-image`.
**Trigger:** Owner clarified that the laptop itself should reveal as the visitor scrolls the page; the product screenshot should not be an inner scroll area.
**Docs touched:** DSD public landing; DESIGN.md materialization; platform landing asset guidance; index.

## Decisions

- Present the real ArkiLaunch fleet screen inside a lightweight CSS laptop frame. Drive the laptop's perspective, scale and opacity with the page's full view-progress timeline as it crosses the viewport, so it opens into view as the visitor scrolls down and reverses when they scroll up. Use IntersectionObserver for browsers without CSS view timelines, and show it immediately without motion when reduced motion is requested.
- Keep the inventory screen static and non-focusable. Capture a landscape viewport with synthetic sample API responses and six equipment groups; ship a proportional 800px WebP. Do not embed a logged-in live application or ask visitors to scroll inside the screen.
- Simplify the four feature illustrations and remove their filled background tiles. Remove the eyebrow dash and the separate green checkmark, keeping the surrounding hero copy.

The presentation uses CSS scroll-driven animation documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations), while using ArkiLaunch's own interface rather than a stock device image.

## Verification

- `pnpm.cmd --filter @arkilaunch/web typecheck` passed for the browser and Worker TypeScript projects.
- `pnpm.cmd --filter @arkilaunch/web build` passed. Vite reports the existing large-chunk warning for application and map bundles.
- The sample captures are 1440×810 (59,478 bytes) and 800×450 (24,762 bytes); the screen is static with no inner scroll controls.
- Browser inspection confirms the laptop transform changes at multiple page-scroll positions using a CSS view timeline, with an IntersectionObserver fallback and no motion under reduced-motion settings.
- No test suite was run for this visual-only change.

## Rollback

Restore the prior inventory preview and simple open-card feature scenes. No API, data or service changes are involved.

## Superseded

On 2026-10-04, the owner asked to replace the laptop presentation. See `cr-arkilaunch-platform-landing-dashboard-image` for the current static dashboard image.
