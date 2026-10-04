# Change Record: Platform landing dashboard image

**Date:** 2026-10-04
**Status:** Applied
**Trigger:** Owner asked to change the hero image and drop the laptop effect.
**Docs touched:** DSD public landing and asset guidance; DESIGN.md materialization; platform landing asset guidance; platform social metadata; index.

## Decisions

- Show a direct screenshot of the ArkiLaunch dashboard in the hero. Use a modest image shadow and responsive WebP sources, with a caption identifying illustrative sample data.
- Remove the laptop chassis, inner-scroll screen, and all laptop-specific scroll animation. Keep the dashboard screenshot itself static; content-section reveals remain independent.
- Regenerate the screenshot from the actual dashboard route with intercepted sample API responses. Update Open Graph and Twitter image metadata to use the new dashboard image.
- Keep production records and live authenticated application embeds out of the marketing page.

## Verification

- Captured the current dashboard at 1440×810 and generated a proportional 800px WebP with synthetic sample responses.
- Inspected the capture and the homepage: the dashboard heading, finance KPIs, weather alert and field-log review queue render in the direct static image.
- `pnpm.cmd --filter @arkilaunch/web typecheck` and `pnpm.cmd --filter @arkilaunch/web build` pass. No test suite was run for this visual change.

## Rollback

Restore the prior inventory image references and regenerate the static inventory screenshot. Do not restore the laptop chassis or scroll effect.
