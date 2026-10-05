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

## 4. Equipment blocked-dates filter (QA 31)

**Before:** blocked dates (`maintenance_windows`) were visible only inside one unit's Report & maintenance modal. The only fleet-wide view was "blocks ending soon".

**After:**
- **`GET /equipment?blockedFrom=&blockedTo=`** (Manila `YYYY-MM-DD`). It keeps units with a window touching those days, and a missing `blockedTo` means from that day on. It is an `exists` overlap on `maintenance_windows` (end exclusive, same predicate as availability) and runs under RLS with an explicit tenant match.
- Each list item carries **`nextBlock`**: the current or next window `{ startsAt, endsAt, notes }`, from one query per page.
- **Equipment page:**
  - A **Blocked dates** filter: Any / Blocked now or later / Blocked in the next 7 days / Blocked between dates (two date fields).
  - Every blocked unit shows a chip such as "Blocked Mar 10 – Mar 12" or "Blocked until Mar 12", with the window's note as its tooltip.
  - For staff who manage the fleet, the chip opens the unit's modal on its Blocked dates tab.

## 5. Installable web app with "Add to home screen" (QA 30)

**Before:** no web manifest and no app icons. The push service worker was registered only when someone turned on weather alerts, so the browser never offered to install the app.

**After:**
- **Manifest.**
  - `public/manifest.webmanifest`: ArkiLaunch, `standalone`, steel-black theme, paper background, with 192/512 and maskable 512 PNG icons in `public/icons/`. The icons are drawn from BRAND.md §2's amber "A" lamp, with `mark.svg` as the source.
  - On a tenant host the Cloudflare worker serves `/manifest.webmanifest` from `webManifest(tenant)` (`src/lib/brand.ts`). The home screen shows the tenant's name (short name = its first word, up to 12 characters) and its header or primary color. The tenant's square icon is listed first, with the platform PNGs kept so the browser can always install. The response is cached like the other tenant reads.
- **Head.** `index.html` links the manifest, theme color, apple-touch icon and the standalone metas. On a tenant host the worker drops the platform theme color and touch icon when the tenant supplies its own, so the tenant's are the ones the browser reads.
- **Service worker.** `sw.js` is registered on every load (`main.tsx`). It still has no fetch handler, so nothing is cached or served stale. Current Chrome needs only the manifest and a registered worker to install.
- **Prompt.** `InstallPrompt` is mounted at the root on every surface (customer, staff, field).
  - It shows only on a phone (narrow or coarse pointer) and never when the app is already running standalone.
  - Android/Chrome: "Add {tenant} to your home screen" opens the browser's install sheet (`beforeinstallprompt`).
  - iOS Safari, which has no install API: "Tap Share, then Add to Home Screen".
  - "Not now" is remembered per browser in `localStorage`, guarded so private mode only means it returns next visit.

## 6. eDTR scans only against deployed sites and machines, identified by the sheet's QR (QA 32)

**Before:**
- The Record-a-field-log and DTR-scanning screens listed **every** booking in the tenant, in any status, and **every** unit in the fleet, for timekeepers too.
- The server checked the timekeeper's site but fell back to "any tenant unit" when a booking had no assignments.
- The printed sheet's QR (`ARKI-EDTR3:rental:unit:week`) was drawn but never read back.

**After:**
- **`GET /field/scan-targets`** (`edtr:create`), grouped per booking with its site name, customer, booking code and machines.
  - A **timekeeper** sees only machines **on site now** at their assigned sites. On site means delivered (`active`), or a legacy deployment left `scheduled` but marked deployed, already started and active on no other booking (`common/deployed.ts`, the site hub's rule in SQL).
  - **Staff** see every site, plus machines **returned in the last 14 days** for late paper, labelled "returned".
- **Capture guard.** `POST /edtr` from a timekeeper also needs that machine on site on that booking (`422 equipment_not_deployed`). This removes the "any unit" fallback for timekeepers. Staff keep the existing rental-span rule.
- **One picker everywhere** (field dashboard, `/field/scan`, `/app/ocr/deployments`, Field logs, site hub):
  - **Site and booking**, then **Machine on site**, both fed by scan-targets. A step with one choice is picked automatically, and the site hub limits it to its own site.
  - The deployment list shows each site booking with its machines and serials.
- **QR in the browser.** When a sheet photo is chosen, the browser's own `BarcodeDetector` (no library; Chrome/Edge on Android) reads the QR.
  - It **picks and locks** the site and machine ("Matched from the sheet's QR code …").
  - If the QR names a machine outside the user's scope, the photo is refused before upload (`sheet_unit_out_of_scope`).
  - Where `BarcodeDetector` is missing (iOS Safari), the manual picker stays.
- **QR in the OCR worker.** The eDTR read now asks Azure DI `prebuilt-layout` for the **barcodes** add-on (`features=barcodes`), and the adapter returns `barcodes`. `sheetQrCheck` (shared) compares the QR with the booking and unit the capture was filed under:
  - **mismatch** → review flag `sheet_qr_mismatch`, `status = 'review'` and `last_error` set, even if the hours reconcile. It never bills on its own.
  - **missing** (a blank or damaged sheet) → review flag `sheet_unidentified`. The day is excluded from bulk approve, so a person confirms the machine.
  - **match** → no flag.
  - The flags read in plain words in the approval drawer (`REVIEW_FLAGS`). RFC-2 is unchanged: reconciliation never deducts, approval does.
- The QR format moved to shared (`edtrSheetQrPayload`, `parseEdtrSheetQr`), so the printed and the read payloads cannot drift.

## 7. Names and addresses read per PH ID format (QA 36)

**Before:** only the LTO driver's license had a label-aware reader (`parseIdText`). Every other ID relied on the generic `FirstName`/`LastName`/`Address` query fields, which mixed up name order on some cards and often missed the address.

**After:** `parseIdText` uses a per-type layout table, based on current card samples:

| ID | Name | Address |
|---|---|---|
| PhilSys / ePhilID | split: Apelyido/Last Name, Mga Pangalan/Given Names, Gitnang Apelyido/Middle Name | Tirahan/Address |
| Driver's license (LTO) | combined "LAST, FIRST MIDDLE" (unchanged) | Address |
| UMID | split: Surname, Given Name, Middle Name | Address |
| Voter's ID | split: Surname, First Name, Middle Name | Address |
| PRC | split: Last Name, First Name, Middle Name | none on the card |
| Passport | split labels, then the **MRZ** (`P<PHLSURNAME<<GIVEN<NAMES`) overrides | none on the card |
| Postal ID | "Name" line: First M. Last (a lone initial is the middle name) | Address |
| TIN ID | "Name" line: LAST, FIRST MIDDLE | Address |
| SSS | unlabelled; left to the query fields | none on the card |

- A label's value is the rest of its own line ("Address: …") or the next line that is not a label.
- An address joins up to four lines and stops at any other label (date of birth, sex, precinct, CRN/PRN/TIN, validity, signature …).
- Anything a layout can't find falls back to the query-field value, as before.
- Company documents are unchanged: the BIR COR 2303 already reads `registered_address`, and the SEC certificate rightly has none.
- The read remains a typing aid: staff still confirm every field under RFC-2, and confidence comes from the words' own spans.
