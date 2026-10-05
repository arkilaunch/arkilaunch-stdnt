# Change Record

**Title:** Customer signup contact details and driver's licence reading
**Date:** 2026-10-05
**Status:** Applied on feature branch
**Traceability:** PRD-F6/F7/F8; customer QA findings 3, 4, 5 and 6; approved signup GUI 144:1496

## Decision

Customer `/signup` collects first name, last name, Philippine mobile, email, job title/position and password in the approved order. Confirm-password, terms, the existing redirect and optional company setup remain. The password minimum stays 12 characters. Platform rental-business registration and approval states are outside this change.

Migration 0081 (`0081_user_signup_contact`) adds nullable `users.contact_first_name`, `contact_last_name` and `job_title`. Mobile uses the existing customer-writable `users.phone`, validated and normalized by `PhMobileSchema`. Staff-confirmed KYC legal-name columns remain separate and untouched by signup. The seven-argument `customer_register` overload retains SECURITY DEFINER, `search_path = public`, active-tenant and global email checks, customer role, PUBLIC revocation and app-role execution. The prior overload remains during rollout for application rollback. Authenticated `/users/me` exposes the contact fields; the existing profile shows them read-only.

Picked images use a separate scanner path. A detected quad retains correction; bright white files are checked for contrast rather than camera glare. Without a usable quad, a full frame can be accepted only at a normalized aspect ratio of 1.24 to 1.70, with dimensions at least 100 pixels, ready contrast, distributed horizontal edges spanning at least 55% of width and 35% of height, and edge density no greater than 18%. This covers ID-1, A4 and Letter in either orientation while keeping blank, tiny-content and dense-noise images in manual review. Live camera analysis, shutter frames and native camera-input rules remain unchanged.

A driver's-licence-only parser reads Azure layout lines anchored on the combined name label and Address label. It preserves the surname before the first comma, splits the last remaining token as middle name, and keeps multiple given-name tokens together. Without the comma it leaves query fields unchanged. Address lines stop at known licence labels and join with commas. Successful parsed fields override query guesses. Word-span confidence is retained, with zero for missing confidence; no confidence or human-review gate is weakened. PhilSys and other IDs and SEC/BIR parsing stay unchanged.

## Scope and safety

No new public read data, tenant table, auth guard, session behavior, approval decision or money movement. OCR remains evidence and every document still needs staff review. The parser uses printed labels, never specimen values. Tests use synthetic documents and mocked OCR; no live Azure calls are required.

## Verification

Migration and seeds ran only against localhost:5442. API and browser QA used ports 3102 and 5182. No live Azure extraction calls were made.

Shared tests: 323 passed. Web tests: 479 passed with one worker and a 15-second test timeout; the initial default-timeout run hit an unrelated maintenance-modal timeout, whose isolated retry also passed. Focused scanner/capture tests: 22 passed, including dense-noise rejection. DB: 66 passed; mocked Document Intelligence: 17 passed; weather: 20 passed; jobs: 46 passed. An existing fixed-ID onboarding fixture collided on repeated local runs; it now uses a fresh ID per run, and all 33 onboarding tests pass.

The first full API run passed all six AI-01 through AI-06 tests. The final repeat run has 344 passing and three failing tests across 53 files: onboarding passes, but AI-01, AI-04 and AI-06 fail before their safety assertions. `ai-abuse.spec.ts` selects the rental and equipment using separate `LIMIT 1` queries. A read-only check on localhost:5442 confirms that the selected equipment is absent from all four active assignments on the selected rental. `EdtrService.capture` correctly rejects it with `equipment_not_on_rental`. This pre-existing fixture mismatch remains outside the assigned implementation scope; the latest full abuse gate is blocked, not passed.

Typecheck and both frontend/backend builds pass. All changed TypeScript files pass lint. Global lint remains blocked by eight existing `no-undef` errors in `scripts/capture-platform-preview.mjs`, outside this package's scope.

Playwright `document-scanner.spec.ts` and `signup-kyc.spec.ts`, using desktop and mobile projects: nine passed, five intentionally skipped matrix combinations. Signup validation, normalized contact persistence, full-frame licence upload, correct name/address suggestions, continuing and returning through the wizard passed at 360, 375, 390, 430 and 1440 pixels. Assertions check no horizontal overflow, 44-pixel action targets and reachable address/footer controls. Screenshots were inspected for all viewport sizes. OCR is mocked at the external boundary with actual parsed layout text.

Local evidence: `pb-tests.log`, `pb-web-retry.log`, `pb-api-tests.log`, `pb-api-final.log`, `pb-onboarding-retry.log`, `pb-packages.log`, `pb-scanner-final.log`, `pb-e2e.log`, `pb-lint.log`, `pb-scoped-lint.log`, `pb-typecheck.log` and `pb-web-build.log`. Screenshots are in `apps/web/test-results/signup-kyc-signup-and-tightly-cropped-licence-at-{width}px-{project}/` as `signup-{width}.png`, `licence-{width}.png` and `licence-address-{width}.png`. Logs and screenshots remain ignored local artifacts.

Tenant-isolation, migration, restraint and static OCR safety reviews pass; the full automated abuse gate remains blocked by the fixture issue above. The migration preserves the prior registration overload; excluded registration routes, auth/session code, SEC/BIR parser and navigation sources are untouched.

## Sources

Validated against [Zod parsing](https://zod.dev/basics), [React state](https://react.dev/reference/react/useState) and [PostgreSQL 17 function security](https://www.postgresql.org/docs/17/sql-createfunction.html). Existing shared validation, tenant transactions and UI primitives are reused.
