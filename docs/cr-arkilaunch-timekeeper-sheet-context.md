# Change Record

**Title:** Timekeeper sees the full sheet header at capture and nothing of processing after submit
**Project:** ArkiLaunch
**Date:** 2026-10-07
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Owner request 2026-10-07 (show the timekeeper the whole EDTR picture; no processing of papers after they submit)
**Docs touched:** [cr-arkilaunch-edtr-site-hub-approval.md](cr-arkilaunch-edtr-site-hub-approval.md) §2 #5 (amended here); [index.md](index.md) §2

---

## 1. Summary

When recording a field log, the timekeeper saw only the site, booking, machine and week. The printed v3 sheet header holds more than that. After a paper submit, the capture modal also polled the log and showed office processing: status, "Reading the sheet…", OCR columns, confidence chips and the reconciliation state.

Now the timekeeper sees every header field of the sheet before sending it. Once the sheet is sent, the timekeeper sees nothing more of it.

## 2. Approved behaviour changes

- **Sheet header at capture (timekeeper, `submitOnly`).** Once a booking is picked, the modal shows an "On the sheet" panel with the same header the printed sheet carries:
  - booking code
  - charge to
  - equipment (type · model · SN)
  - project location
  - operator
  - client site rep
  - rental period
  - date covered (Mon–Sun)
  - hour meter at start of week
- **After submit (timekeeper, paper and typed).** The timekeeper gets a "Sent to the office" toast and the modal closes. There is no polling of `/edtr/:id`, no OCR readout, no confidence chips, no status and no "Retake the photo" prompt. An unreadable sheet is handled by the office: it transcribes the hours from the photo, or requests a correction.
- **Unchanged.**
  - Notifications to the timekeeper: `edtr_approved`, `edtr_needs_correction`, `edtr_rejected` and `edtr_review` are kept.
  - The offline upload queue.
  - Staff capture (site hub, `/edtr`, `/app/ocr/deployments`), which still polls and shows the OCR readout.
  - The site scope: the timekeeper still sees only their assigned sites.

## 3. Data and API

There is no migration and no new endpoint. The panel reads the existing `GET /api/v1/bookings/:id/edtr-sheet` endpoint:
- It requires `edtr:create`.
- A timekeeper gets 404 `booking_not_found` for an unassigned site.
- Reading it does not count against the daily sheet download limit.
- The tenant comes from the verified JWT (RFC-1).

## 4. Not in scope

- A timekeeper list or history of their own submissions. Add one if timekeepers need to look back at what they sent.

## 5. Verification

| Suite | Result |
|---|---|
| web `capture-modal.test.tsx`, `app.ocr.deployments.test.tsx` | 5 passed. The new case checks that the header panel renders, that the modal closes on submit, and that no `/edtr/:id` read happens. |

Typecheck is clean for web. Lint is clean on the changed files.
