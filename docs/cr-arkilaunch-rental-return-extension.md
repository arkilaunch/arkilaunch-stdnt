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

- **Extension charge.** Staff see a suggested charge on pending extension requests, calculated from the latest approved, sent or accepted quotation's saved hourly rate (highest revision, with creation time and ID breaking ties) for each extended unit's equipment type, multiplied by the extra booking days and the tenant's daily hours, then rounded to two decimal places. Any missing rate makes the suggestion unavailable. Staff must give an audit-logged reason only when changing an existing suggestion; with no suggestion, an explicit amount is required and the reason is optional. A positive approved amount creates an issued `extension` invoice payable within seven days, appears in the balance and statement, and can be paid through customer checkout. Every approved extension adds the extra booked hours, including a free extension. Zero amounts and rejected requests create no invoice. Approval rechecks availability and serializes request resolution.
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
| `PATCH /api/v1/bookings/:id/change-requests/:requestId` | `decision`; optional `chargePhp` (nonnegative, at most two decimals) and trimmed `chargeReason` (1..500 characters). A reason is required only when a suggestion exists and the explicit amount differs from it. With no suggestion, the amount is required and the reason is optional. |
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

Final pre-merge evidence recorded on 2026-10-15 for code head `89c3b2e`:

| Check | Result |
|---|---|
| `pnpm lint` | Passed; two existing unused-variable warnings in `app.inventory.tsx` |
| `pnpm typecheck` | Passed after the final web fixes |
| Build checks | Workspace build passed during implementation; API build passed after the charge fixes with zero TSC issues |
| `pnpm --filter @arkilaunch/shared test` | 34 files, 395/395 tests passed after the charge fixes |
| `pnpm --filter @arkilaunch/web test --maxWorkers=2 --testTimeout=15000` | 90 files, 559/559 tests passed after the final web fixes |

DB-backed verification at `e19cd01` used a fresh local PostgreSQL 17 database with migrations and `db:seed:test`, following the CI `api-integration-suite` steps. The subsequent commits `6fb2521` and `89c3b2e` changed only the web application.

| Suite | Result |
|---|---|
| `pnpm --filter @arkilaunch/api test` | 58 files, 391/391 tests passed |
| `pnpm --filter @arkilaunch/jobs test` | 7 files, 50/50 tests passed |
| `@arkilaunch/db` pooler-independent suites | 7 files, 60/60 tests passed: tenant-isolation, rls-enumeration, audit-log-immutability, after-commit, seed-identities, equipment-type-cleanup and deposit-ledger |
| Migration 0090 | Applied cleanly after migrations 0001-0089 |

Browser QA used the local API and web application against a seeded local database with all external services disabled, exercising customer and admin roles:

- The customer booked, accepted the quote, paid and received deployment, then requested a three-day extension for one unit.
- The approval dialog suggested PHP 20,400 (PHP 850/hour × 8 hours × 3 days). An override to PHP 18,000 required a reason stored in the approval audit. An issued extension invoice for PHP 18,000 was due in seven days. The extended unit's end date and booked hours changed from 24 to 48; the other unit stayed unchanged. The balance refreshed without a reload.
- Returning the booking stored per-unit condition notes and completed the booking. The flagged unit used `maintenance`, displayed as Unavailable (repair), and the other unit became available. The repair audit and Equipment sent for repair staff notification appeared; no `deposit_deduction` invoice was created.
- The customer catalog hid the repaired unit, and the customer ledger displayed Rental extension · Issued PHP 18,000.

The charge QA fixes include accepted quotations in deterministic suggestion selection and require a reason only when overriding an existing suggestion; no suggestion requires an amount but permits an optional reason.

The web QA fixes refresh both staff/customer statement caches after request resolution and put inventory names and status badges on separate rows; desktop and mobile header checks passed.

Commit `003d252` made the adversarial fixture's rental/unit selection deterministic and valid for its report dates; every assertion stayed unchanged.

Pre-merge reviews: tenant isolation PASS; migration/RLS PASS; restraint PASS with notes applied; abuse review PASS. Extraction/reconciliation review is not applicable because those production paths were unchanged.
