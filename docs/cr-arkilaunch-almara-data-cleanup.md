# Change Record

**Title:** Record fixture category cleanup and Almara registration reset
**Project:** ArkiLaunch
**Date:** 2026-10-06
**Status:** Applied to the configured hosted database; operational record
**Traceability:** PRD-F4 / US-04; PRD-F7; RFC-1 identity and tenant isolation
**Docs touched:** index.md. No Locked contract, schema, RLS or application code changes.

## Scope and authorization

The owner authorized removing recognized dummy equipment types, retaining equipment
under Others, and freeing three customer emails for fresh registration. Other
suspected dummy records were requested for review only. The final account retirement
was conditional on the account belonging to the Almara tenant.

The configured local-development database is hosted Supabase project
`ydalnvzyeseycdakofgp`. A separate production connection was not established, so this
record makes no claim that a second environment was cleaned. The account lookup
confirmed the target accounts belonged to tenant `almara`.

## Applied changes

The existing `cleanup:equipment-types` maintenance command removed eight recognized
fixture categories: three Money Path Cap Fixture types and five Rate Card Test Type
types. Four unused fixture rate cards were removed and three equipment units were
moved to Others. All 2,017 equipment records and 24 legitimate categories remained.
Historical quotation rows and unrelated rate cards were preserved.

Two customer accounts with no linked records beyond refresh tokens were deleted,
including their ten refresh-token rows. A third customer account had company,
audit, negotiation, truck-request and site-document history. With the owner's
approval, its email was replaced by a unique internal `accounts.invalid` address,
its status was disabled, and all 132 refresh-token rows were marked revoked. Its
user ID, tenant, company records and historical references remained intact.

A fresh read-only check confirmed all three requested normalized email keys were
absent from `users`, so they are available for registration. Email addresses and
private backup contents are deliberately excluded from this public-facing record.
Previously issued access tokens retain their normal expiry; refresh revocation
prevents renewal.

## Preservation and recovery

Each operation saved and verified a compressed backup under the local ignored
`.git/codex-backups/` directory before changing data. Backups are not committed.
The transactions rolled back on unexpected dependencies, mutation counts or
preservation failures. Account deletion checked every live inbound user foreign
key and locked the related tables before deletion.

Category cleanup compared complete retained rows in its four affected tables;
a preflight also confirmed zero fixture references in `equipment_type_costs`.
The account retirement compared all 59 public tables against their expected rows,
allowing only the target email/status and refresh-token status changes.

Recovery requires an administrative transaction and the private local backup.
Restore deleted users before their refresh-token rows. For retirement, restore
the original email only after ensuring no new registration has claimed it; restoring
an old session is a separate decision. For categories, restore original type and
rate rows before restoring equipment classification, following the existing
category cleanup runbook. Do not overwrite subsequent legitimate changes.

## Other suspected fixtures pending review

No further deletions were authorized or applied. Findings include tenants
`test-tenant-a` and `test-tenant-b`, seven accounts with test-like email patterns,
and equipment labelled Money Path Cap Unit (79), E2E Backhoe II (18), Test 50t Crane
(11), E2E Paver (11), Test Roller (11), and five other test-labelled units. These
labels are evidence for review, not sufficient authorization to delete equipment
or associated rentals, billing, KYC or history. Serial-number findings can overlap
these units and must not be added to the model counts.

## Verification and gates

- Category apply: committed; eight types and four rates removed, three units moved,
  all 2,017 equipment retained.
- Fresh category preview: zero recognized fixture categories or rates remain.
- Account deletion: committed; two accounts and ten sessions removed; unrelated
  users and refresh-token rows preserved.
- Account retirement: committed; Almara verified, disabled, 132 refresh rows revoked,
  all 59 public tables matched expected data.
- Fresh account check: all three email keys available; retired account belongs to
  Almara and has zero unrevoked refresh rows.
- Tenant-isolation checker: PASS for the operational plans and preservation controls.
- Migration-RLS guardian: PASS; no schema/RLS changes and verified atomic backups.
- OCR worker and AI abuse runner: not applicable; no AI-path changes.
- Restraint review: reused existing category tooling; no dependency, abstraction,
  application feature or migration added.
- Application test suites were not run: no implementation changed, and hosted
  integration runs can repopulate fixture data. Verification used transactional
  row comparisons and fresh read-only database queries.
