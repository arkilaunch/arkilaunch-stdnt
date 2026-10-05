# Change Record

**Title:** QA batch 29–36: truck arrival times, installable web app, equipment blocked-date filter, eDTR scans scoped to deployed units, blank eDTR template, office mark-as-paid then deploy, peso-based revenue leakage report, per-format ID parsing
**Project:** ArkiLaunch
**Date:** 2026-10-06
**Version:** 0.1
**Status:** `In progress` (branch `feat/qa-batch-29-36`)
**Trigger doc:** Owner QA feedback items 29–36 (2026-10-05)
**Docs touched by this record:** [sdd-arkilaunch.md](sdd-arkilaunch.md) §3 and the trucks contract (updated per section as each lands)

---

## 1. Truck arrival times (QA 29)

**Before:** the stored trip duration was the router's free-flow *car* time. For example, Pililla to Taytay is 35 km in 48 min (about 44 km/h), which no loaded truck manages on Rizal roads. Before dispatch, both the staff drawer and the customer trip showed "~ pickup + 48 min drive" and never an actual arrival time.

**After:**
- **Truck minutes at the source.** `parseOsrm` and `parseOrs` store `truckMinutes(km, routerMinutes, truckSafe)` from `packages/shared/src/trucks.ts`. This is the router time scaled ×1.45 for the OSRM car profile or ×1.15 for the ORS HGV profile, with a floor of 30 km/h average truck speed. The same QA trip now reads 70 min. The map label, estimate and stored `route_minutes` all read this one value. Rows created before this change keep their old minutes.
- **Rush hour.** `truckEta` multiplies by 1.3 for a departure on a weekday from 07:00 to 10:00 or 17:00 to 20:00 Manila time, before pushing an arrival past any stored truck-ban window.
- **An arrival range with a clock time.** `truckArrivalWindow(departAt, minutes, cities, rules)` returns the early and slow ends (×1.25), each pushed through the ban windows.
  - The staff drawer and the customer trip show "Est. arrival Mon, Oct 5, 9:31 AM – 9:54 AM (91–114 min truck drive)", counted from the booked pickup.
  - After dispatch they show the saved `eta_at`, as before.
  - The map label reads "~35 km · 1 h 10 min–1 h 28 min truck drive (estimate)".
- **Calibration.** The factors live in `TRUCK_TIME`. They are an estimate: the admin still confirms the km a customer is charged on.
