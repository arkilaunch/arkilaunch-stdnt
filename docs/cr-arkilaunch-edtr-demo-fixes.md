# Change Record

**Title:** Whole sheet photo, photo beside its readings, hour meter read, no QR gate, timekeeper done on send, admin remove of a field log
**Project:** ArkiLaunch
**Date:** 2026-10-07
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Owner request 2026-10-07 (demo prep)
**Docs touched:** [cr-arkilaunch-timekeeper-sheet-context.md](cr-arkilaunch-timekeeper-sheet-context.md) §2 "After submit" (amended here); [index.md](index.md) §2

---

## 1. Summary

Six owner-requested changes to the EDTR capture and review screens.

## 2. Approved behaviour changes

- **Whole photo.** When the printed sheet marks are not found, the capture keeps the whole photo. It no longer falls back to the paper-edge crop, which cut at the table border and lost the header and QR. Previews grow from a 384px cap to 75% of the screen height (timekeeper capture, site hub drawer).
- **Photo beside its readings.**
  - Field logs `ScanReview`: the parsed panel is top-aligned and sticky beside the photo. It is no longer pushed down to the hours row.
  - Site hub review drawer: the photo is on the left and the flags and hours are on the right. The drawer widens for paper logs.
- **Hour meter read.** METER START/END cells are now cleaned like every other comb cell: box outlines, commas and edge dots are stripped. Six digits with no dot read as 5+1, so `123456` is 12345.6, because the comb prints the dot and the reader drops it. The headers also match when the reader prefixes them (`HOUR METER START`). `meter_backwards` and `meter_running_mismatch` stay as the safety net.
- **No QR gate.** The capture modal no longer warns "The sheet's QR code is not in the photo" or blocks the submit when no QR is read. The QR still pre-fills booking and machine when read. A sheet without one is still flagged `sheet_unidentified` for staff by the worker. A QR naming a machine outside the user's sites still blocks.
- **Timekeeper done on send.** This amends the timekeeper-sheet-context CR. A paper sheet now closes the modal with the "Sent to the office" toast, like a typed log. There is no quiet polling and no on-site retake prompt. An unreadable photo comes back to the office as `hard_failed`, and staff transcribe it or ask for a retake.
- **Remove a field log (admin).** The Field logs Actions column gets a "Remove" button for admin and platform_admin, behind a confirm. `DELETE /api/v1/edtr/:id` (`edtr:approve`):
  - It deletes the log, its line item and its reconciliation.
  - It resets the other log's reconciliation to `pending` with no counterpart.
  - It refuses with 409 `already_billed` if either side's reconciliation is approved or the log has an invoice line or deposit accrual.
  - The tenant comes from the verified JWT and RLS (RFC-1). An `audit_logs` DELETE row is written. No money moves (RFC-2).

## 3. Data and API

There is no migration. The new endpoint is `DELETE /api/v1/edtr/:id`. DELETE on `edtr`, `edtr_line_items` and `edtr_reconciliations` was already granted to `app_authenticated`.

## 4. Not in scope

- A removed log's photo stays in the storage bucket, and any weather incident event keeps its `edtr_id`. Add cleanup if removal outgrows demo and clean-up use.

## 5. Verification

| Suite | Result |
|---|---|
| shared `edtr-sheet.spec.ts` | New hour meter case (box edges, comma, dropped dot, edge dots); shared 383 passed |
| web | 549 passed; `capture-modal.test.tsx` now checks that the modal closes after a paper send and never polls |
| api `edtr-engine.spec.ts` | New `remove()` case (unbilled removed and counterpart freed; billed refused), run in CI |
