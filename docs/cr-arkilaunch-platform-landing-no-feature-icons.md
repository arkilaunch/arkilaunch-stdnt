# Change Record: Platform landing feature cards without icons

**Date:** 2026-10-04
**Status:** Applied
**Trigger:** Owner asked to remove the feature-card illustrations as visual clutter.
**Docs touched:** DSD public landing; DESIGN.md materialization; index.

## Decision

Remove decorative illustrations from all four platform landing feature cards. Keep the 01–04 labels and let spacing, headings and descriptions carry the design. Do not replace the illustrations with glyphs or other icons. This supersedes the feature-scene portion of `cr-arkilaunch-platform-landing-branding`; its wordmark-only navbar decision remains in effect.

## Verification

- Web typecheck and production build.
- Confirm the four cards render with number labels, headings and descriptions and no icon markup.

## Rollback

Restore the previous feature illustrations and design-system guidance. No routes, data or API behavior are involved.
