# Change Record: Weather evidence coverage and retention

**Date:** 2026-11-15
**Status:** Applied in code; client deployment remains disabled
**Trigger:** Owner review of weather incident and field-log evidence
**Scope:** PRD-F5 / US-05, field-log weather checks, S14 incident evidence

## Decision

The 30-minute Open-Meteo poll remains on the free, keyless plan for development. Production polling remains disabled. Historical lookup is an optional, reviewer-requested development feature, disabled for client deployment. No weather evidence automatically changes billing or a deposit.

## Behavior

- A field-log weather mismatch requires saved readings in every 30-minute work slot except at most one per relevant half; at least one reading is always required. D1 requires both halves; D2 requires the half it flags. Missing coverage is shown as insufficient, not a clear result.
- A system stop-work incident requires near-complete readings that include the specific machine during its reported work window, with a stop-work level recorded in that window. A warning is not presumed active until midnight. The sheet's own HR/W/T rule remains independent of the feed.
- `GET /api/v1/edtr/:id/weather-evidence` returns AM/PM windows, coverage counts and any historical snapshot under the field log's tenant and site permissions. `POST /api/v1/edtr/:id/weather-evidence/historical` requires `edtr:approve`, is rate-limited, and fetches one Manila day of hourly Open-Meteo historical reanalysis only when saved coverage is insufficient and `ENABLE_WEATHER_HISTORY=true`. A unique per-tenant, per-log event caches its validated source, best-match model, fetch time and readings. The modelled data is displayed as supporting evidence only.
- Detailed `weather_alerts` readings have a 24-month retention target. The daily retention job counts eligible rows by tenant and deletes in 1,000-row batches only with `ENABLE_WEATHER_RETENTION=true`. It is disabled by default. Incident and historical evidence events remain. Migration 0095 adds the retention and unique-event indexes.

## Deployment and verification

Keep production `ENABLE_WEATHER_POLL`, `ENABLE_WEATHER_HISTORY` and `ENABLE_WEATHER_RETENTION` off. Before enabling retention against client data, preview eligible counts, confirm backups and rehearse the batch job. Commercial Open-Meteo access and a separate deployment decision are required before enabling weather polling or historical lookup for a client.

Provider references: [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) describes the reanalysis source and hourly data; [Open-Meteo terms](https://open-meteo.com/en/terms) restrict the free API to non-commercial use.

Focused checks: shared weather coverage and D1/D2 cases, historical response validation, tenant-scoped API checks and idempotent history, retention dry-run/apply behavior, plus existing weather and field-log integration tests. All weather paths remain evidence-only.
