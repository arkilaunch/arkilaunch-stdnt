# Change Record: Platform landing scroll reveals

**Date:** 2026-10-04
**Status:** Applied
**Trigger:** Owner requested scroll animation on the platform landing, especially on the hero image.
**Docs touched:** DSD public landing motion; DESIGN.md materialization; index.

## Decision

Use a CSS view-progress timeline across the laptop's passage through the viewport where supported. Page scroll scrubs its opacity, perspective, scale and vertical position from a distant angle to a clear product view; scrolling upward reverses the reveal. Use a one-time IntersectionObserver entrance as the browser fallback. Feature and setup cards use a short stagger as their sections enter view. Preserve layout space while content animates. If observers are unavailable or `prefers-reduced-motion: reduce` is set, content starts visible without transitions. Replace the now-retired step carousel motion reference with the visible in-flow setup steps. Do not add dependencies.

## Verification

- `prefers-reduced-motion` and the observer-unavailable path both initialize reveals as visible.
- Browser and Worker typecheck and production build pass. No test suite was run for this visual change.

## Rollback

Remove the platform reveal hook and CSS classes, then restore immediate visible rendering. No data or service changes are involved.
