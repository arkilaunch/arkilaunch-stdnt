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

## 2. Office mark-as-paid, then deploy (QA 34)

**Before:** cash could be recorded only on the Payments page, on an invoice the customer had already issued by choosing "pay cash" in the app. A walk-in who paid at the counter left staff with nothing to click in the booking or trip drawer.

**After:**
- **`POST /bookings/:id/mark-paid`** and **`POST /truck-requests/:id/mark-paid`** (`quote:approve`, body `{ receiptNo?: string ≤ 40 }`).
  - `PaymentsService.markPaidAtOffice` runs the same checkout as the customer with an `office` flag, then the existing `recordCash`.
  - The office flag skips the phone-call gate, because the customer is present. For trucks it also skips the in-app price accept, because paying the agreed price in person is the acceptance.
  - Everything else is unchanged: a verified company, an accepted quote for rentals, an agreed price for trucks, the stored invoice amount, and `already_paid`.
  - Settling reuses `settleInvoice`: rental → `confirmed`, truck → `paid`, the customer is notified and the tier is recomputed.
  - An audit row reads "paid at the office; price accepted in person; OR …".
- **OR number.** `payments.receipt_no` (migration `0084`, nullable, 1–40 chars). It is set by mark-paid and by the Payments page's "Record cash payment". It is returned as `receiptNo` on the invoice detail and printed on the invoice as "Official receipt".
- **Drawer:**
  - A booking that is not yet paid shows a Payment card with **Mark as paid (office)**.
  - A truck in `agreed` shows the same button.
  - Once paid, the next step is right there: **Deploy now** (the existing deliver step, renamed from "Mark delivered") or **Dispatch now** (renamed from "Dispatch truck").

## 3. Blank eDTR template in Field logs (QA 33)

**Before:** the blank (hand-fill) sheet could only be downloaded by an admin or owner, from the eDTR card inside a booking's actions.

**After:**
- `BlankEdtrDownload` (PDF / PNG, the company's paper size, letterhead logo and TIN) appears in three places:
  - the **Field logs** page header (`/app/ocr`)
  - the **timekeeper dashboard** (`/field`)
  - the booking eDTR card
- The blank sheet carries no booking, customer, QR or dates, so timekeepers may print it as well, for sampling, training or a hand-filled fallback.
- A scan of a blank sheet has no QR, so §4 flags it for staff to identify before billing.
