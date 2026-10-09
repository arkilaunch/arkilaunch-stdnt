# Change Record

**Title:** EDTR weather to the incident log: who keeps working through flagged weather
**Project:** ArkiLaunch
**Date:** 2026-10-06
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Owner request 2026-10-06 (connect EDTR weather to the incident log and catch the companies that keep using equipment in weather-flagged time)
**Docs touched:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §5 API table; PRD S14 (amendment recorded here); [index.md](index.md) §2; extends [proposal-edtr-weather-attestation.md](proposal-edtr-weather-attestation.md) and [cr-arkilaunch-pricebook-kyc-site-weather.md](cr-arkilaunch-pricebook-kyc-site-weather.md)

---

## 1. Summary

Before this change, a field log only reached the incident log (S14) when the machine had a system `stop_work` warning that day. That warning comes from the Open-Meteo poll, and the poll is disabled in prod (`enable_weather_poll = false`), so nothing was caught there. The sheet already records the weather itself: per AM/PM half, the timekeeper ticks `HR` (heavy rain), `W` (strong wind) or `T` (storm/typhoon signal). No rule used those ticks.

This change makes both sources log the same incident (`equipment_used_despite_warning`, with `source: system | sheet`). Each incident names the renting company, the log tallies incidents per company, admins are told, and an approver records a review status. Everything stays evidence only (RFC-2): no incident, flag or status touches a bill or a deposit.

## 2. Approved behaviour changes

- **Sheet rule (`workedInReportedWeather`, shared).** Running hours > 0 in a half ticked `HR`, `W` or `T` is flagged. `LR` (light rain, work continued) never counts.
  - With per-half time windows (v2 sheet), a half counts only if its window is filled.
  - Without windows: both halves bad flags the whole day. One bad half flags only if no weather downtime hours were logged.
- **One hook (`flagEdtrWeather`, db).** The OCR worker and typed entries run the same checks: system stop-work, the sheet rule, and D1/D2.
  - Each raised flag is appended to `edtr_line_items.review_flags`, on the OCR path too (a gap before).
  - The OCR worker still holds the day in `review`.
  - D1 now fires on v3 sheets: weather hours count as a weather idle reason.
- **Incidents.** One `equipment_used_despite_warning` per field log and source. A new incident notifies tenant admins/owners only (new notice type `equipment_used_despite_warning`: in-app, email, push), linking to the incident.
- **PRD S14 amendment.** Report discrepancies (D1/D2) leave the incident log. They still flag the field log for review and still show in its weather check (`GET /incidents?edtrId=`).
- **Review status.** `open | acknowledged | dismissed`; a dismissal needs a note. The status is stored on the event (`properties.review`), and an `audit_logs` row records who decided and why. Only `edtr:approve` holders can set it.

## 3. Data and API

- Migration `0089_incident_review_edtr_weather.sql` adds:
  - nullable `edtr_line_items.weather_am` / `weather_pm`, with a CHECK against the printed codes, so typed entries keep their ticks;
  - partial index `events (tenant_id, properties->>'rental_id') WHERE name = 'equipment_used_despite_warning'`.

  No new table and no RLS change (both tables are already tenant-isolated).
- `GET /api/v1/incidents`:
  - drops D1/D2 unless `edtrId` is given;
  - accepts `customerId`;
  - returns `customerId`, `customerName` (via the incident's rental), `source`, `status`, `reviewNote` and `reviewedAt`.
- `GET /api/v1/incidents/companies` (STAFF_READ): per company, the number of used-despite-warning incidents (`total`) and the number still open, dismissed excluded.
- `PATCH /api/v1/incidents/:id` (`edtr:approve`): `{ status, note? }`. Returns 404 for an id outside the caller's tenant (RLS).

## 4. Not in scope

- Enabling the prod weather poll. That is an infra and licensing decision (the Open-Meteo free tier is non-commercial). Until it is enabled, only the sheet source fires in prod.
- Any deposit or charge consequence of an incident.
- Manually created incidents.

## 5. Verification

Run on 2026-10-06 against a throwaway local Postgres 17 (CI parity: migrate + two-tenant seed):

| Suite | Result |
|---|---|
| shared | 384 passed |
| jobs | 50 passed |
| api | 379 passed (on a fresh database) |
| web | 536 tests; 2 unrelated 5 s timeouts under full-suite load, both pass when rerun alone |

- Typecheck is clean across shared, db, api, jobs and web, and lint is clean on the changed files.
- Migration 0089 was also applied to the `.env` Supabase database, with the owner's go-ahead.
