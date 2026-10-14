# Change Record

**Title:** Rental extension charges, return conditions and repair availability
**Project:** ArkiLaunch
**Date:** 2026-10-15
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Stakeholder panel feedback (Dra. Domingo, Mr. Violeta)
**Docs touched:** [PRD](prd-arkilaunch.md) PRD-F4/PRD-F8; [SDD](sdd-arkilaunch.md) §3 data and §5 API; [index.md](index.md) §2

---

## 1. Summary

Approved rental extensions previously moved return dates without recording a charge. Whole-booking returns skipped the incomplete-field-log check, and both return paths made every machine available without recording its condition. This change adds extension billing, consistent return checks, per-unit condition notes and repair availability for PRD-F4 and PRD-F8. The approved changes below amend the referenced PRD and SDD sections.

## 2. Approved behaviour changes

- **Extension charge.** Staff see a suggested charge on pending extension requests, calculated from the latest approved or sent quotation's saved hourly rate for each extended unit's equipment type, multiplied by the extra booking days and the tenant's daily hours, then rounded to two decimal places. Any missing rate makes the suggestion unavailable. Staff may override the amount with an audit-logged reason. A positive approved amount creates an issued `extension` invoice payable within seven days, appears in the balance and statement, and can be paid through customer checkout. Every approved extension adds the extra booked hours, including a free extension. Zero amounts and rejected requests create no invoice. Approval rechecks availability and serializes request resolution.
- **Returned.** Whole-booking return keeps the existing stored `completed` status and the displayed Returned label. Both return paths refuse missing, pending or correction-required field-log days before today unless staff confirm with a reason recorded in the audit log. Today's sheet does not block return.
- **Per-unit condition.** The return dialog collects optional condition notes and a Needs repair checkbox for each active assignment. Notes and flags are stored per assignment and displayed on booking detail after return. A supplied assignment outside the booking, or a duplicate assignment ID, is refused.
- **Repair availability.** A flagged machine uses the existing stored `maintenance` availability value, displayed as Unavailable (repair). It remains excluded from booking and deployment until staff restore availability through the existing inventory status change. Other returned machines become available. Each flagged unit gets an equipment UPDATE audit with reason `flagged for repair on return`; one staff notification names the affected machines. A repair flag survives a later whole-booking return and, when a machine has several returned assignment windows, any flagged window keeps it unavailable.

## 3. Data and API

Migration `0090_rental_return_extension.sql` adds:

| Table | Column | Constraint/default |
|---|---|---|
| `equipment_assignments` | `return_condition_notes` | Nullable text; at most 2000 characters |
| `equipment_assignments` | `return_needs_repair` | Boolean, NOT NULL, default false |
| `booking_change_requests` | `charge_php` | Nullable numeric(14,2); nonnegative |
| `booking_change_requests` | `invoice_id` | Nullable UUID referencing `invoices.id` |

The migration is additive. Existing tenant RLS policies and table-level UPDATE grants cover both tables; no new table or grant is needed. Apply migration 0090 before deploying the updated API. An older API can continue to use the expanded schema if the application rollout is rolled back.

| Endpoint | Request/response additions |
|---|---|
| `PATCH /api/v1/bookings/:id/change-requests/:requestId` | `decision`; optional `chargePhp` (nonnegative, at most two decimals) and trimmed `chargeReason` (1..500 characters). A reason is required when the explicit amount differs from the suggestion, including when no suggestion exists. |
| `POST /api/v1/bookings/:id/return` | Optional `units: [{ assignmentId, conditionNotes?, needsRepair? }]`, `confirmIncompleteLogs?`, `reason?`. Assignment IDs are UUIDs; condition notes are at most 2000 characters. Confirmation requires a trimmed reason of 3..500 characters. |
| `PATCH /api/v1/sites/:id/deployments/:assignmentId/return` | Optional `conditionNotes?`, `needsRepair?`, `confirmIncompleteLogs?`, `reason?`, with the same notes and confirmation validation. |
| `GET /api/v1/bookings/:id` | Change requests include `suggestedChargePhp`, `chargePhp` and `invoiceId`; assignments include `returnConditionNotes` and `returnNeedsRepair`. |
| `POST /api/v1/me/invoices/:id/checkout` | Accepts an issued extension invoice owned by the customer's company. |

Errors: `422 extension_charge_required` when no suggested or explicit charge exists; `422 charge_reason_required` for an override without a reason; `409 field_logs_incomplete` with missing/pending dates before an unconfirmed return; `422 booking_unit_not_found` for invalid supplied return assignment IDs. Existing booking closure, overlap and already-resolved checks remain in force.

The customer receives the existing `change_request_resolved` notification with the charge and invoice ID. Staff receive `equipment_needs_repair` with `rental_id` and `equipment_ids`. New writes use the verified RequestContext tenant inside `withTenantTx`; the existing controller permissions and Zod DTO validation apply.

## 4. Not in scope

- Condition notes and repair flags cannot trigger a deposit deduction (RFC-2) or any damage invoice.
- No new rental or equipment status value is introduced.
- No new repair-completion endpoint, automatic repair clearance, refund flow or payment provider integration is added.

## 5. Verification

Checks run on 2026-10-15 after the review fixes:

| Check | Result |
|---|---|
| `pnpm lint` | Passed; two existing unused-variable warnings in `app.inventory.tsx` |
| `pnpm typecheck` | Passed; API typecheck also passed after the redundant guard removal |
| `pnpm build` | Passed across the workspace, including API build with zero TSC issues |
| `pnpm --filter @arkilaunch/shared test` | 34 files, 395 tests passed |
| `pnpm --filter @arkilaunch/web test --maxWorkers=2 --testTimeout=15000` | 90 files, 556 tests passed |

The initial default-concurrency web run passed 555/556 tests and timed out on an existing cart case at five seconds; the complete retry above passed, including the changed booking-actions tests. DB-backed specs add assertions for overdue eligibility immediately after issuing an extension invoice and extra booked hours on a free extension, alongside the extension, return, repair and cross-tenant cases.

Pre-merge reviews: tenant isolation PASS; migration/RLS PASS; restraint PASS, with the shared `reason` field and redundant guard removal applied. The prior DB-backed run passed 388/390 tests and identified the immediate-overdue invoice defect. DB-backed suites will be re-run in pre-merge review after these fixes; they were not run in this task.
