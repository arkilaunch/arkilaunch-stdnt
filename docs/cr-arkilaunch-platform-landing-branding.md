# Change Record: Platform landing wordmark and feature scenes

**Date:** 2026-10-04
**Status:** Applied
**Trigger:** Owner requested a wordmark-only ArkiLaunch navbar and more specific feature-card imagery.
**Docs touched:** DSD public landing; DESIGN.md materialization; index.

## Decision

Use the ArkiLaunch wordmark alone in the platform marketing navigation. Replace generic calculator, truck, clipboard and receipt glyphs with a consistent family of compact line illustrations: construction excavator, rate quotation, field record being reviewed and billing record with approval mark. Use existing steel text and restrained amber detail, without a filled icon tile or outline frame around each illustration. Mark the decorative SVGs as hidden from assistive technology because adjacent headings and descriptions provide each feature's name and explanation. Do not add an icon or image dependency.

## Verification

- Browser and Worker typecheck.
- Production web build.
- Review the four scene compositions at desktop and phone widths.

## Rollback

Restore the navbar glyph and feature icons. No route, data, API or metadata changes are involved.
