# Change Record

**Title:** Rental workflow QA, tenant storefront promotions, and consistent documents
**Date:** 2026-10-20
**Status:** Applied
**References:** PRD-F4/F7/F8; SDD data/API; DSD storefront/dialog/print; QAD money paths.

## Approved changes

The owner approved the implementation plan on 2026-10-20. Signing moves into the existing accessible modal with a compact checkout status, explicit confirmation, preserved drafts, and invalidation on changed terms/quotation. Returns record good condition, normal wear, servicing, or damage while retaining notes. Servicing/damage keep equipment unavailable. Staff prepare damage assessments against the signed agreement; Owner alone approves invoices, with no automatic deposit deduction. Individual deployment uses booked dates; bulk deployment includes due units only. Tenant storefronts receive a refreshed service layout and optional manually configured promotional starting prices, separate from quotation calculations.

All existing PDF and print outputs receive consistent tenant branding, measured wrapping and pagination. Add invoice, successful-payment receipt, and signed-snapshot agreement downloads. Preserve all existing arithmetic and the EDTR scanning layout. Additive migrations precede application rollout; old clients remain compatible.

## Verification

- Fresh local PostgreSQL 17: migrations 0000-0093 applied and two-tenant fixtures seeded. No remote database was migrated.
- Full workspace suites passed with the established constrained-machine settings: `pnpm -r --workspace-concurrency=1 test --maxWorkers=2 --testTimeout=15000`. 1,588 tests passed: shared 423, web 591, database 70, document intelligence 19, weather 20, API 411 and jobs 54. The initial default-worker runs hit existing 5-second UI timeouts; the lower-worker run passed without changing their assertions or production behavior.
- Focused Playwright: 12/12 passed across signing, promotions, invoices, SOAs and quotations, including 360/1440 widths and two tenant brands. All browser API traffic was mocked; data controls were separately verified against the local database.
- Twelve PDF fixtures were rendered to images and checked for pagination, Unicode names, logo scaling, full rows, footer bounds and blank pages. [Visual evidence](qa/rental-qa/README.md).
- Tenant-isolation-checker: PASS. Migration-RLS-guardian: PASS. Restraint-guardian: PASS. OCR extraction/reconciliation/deduction paths were unchanged, so AI-path review gates do not apply. Local database tests do not prove Supavisor-specific pooling; the existing live-pooler CI gate remains unchanged.
- Lint passes with two pre-existing unused-variable warnings in inventory; typecheck and the complete production build pass. The final focused PDF suite also passes with the bundled static font assets.

## Rollout

Apply additive migration 0093 before deploying the API/web update. Rollback retains the expanded schema; older clients may continue using the legacy repair flag and omitted assignment selection. No damage charge is automatically deducted from deposits. Tenant promotions start unconfigured and remain independent of quotations. Unsupported/corrupt logo assets fall back to the tenant's own text letterhead; the branding UI normalizes uploads to PNG/JPEG.

## Document contracts

Shared layout keeps headings with initial content, repeats table headers, wraps long words, reserves running-footer space and keeps signature blocks together. Signed PDFs use stored terms and signing evidence; receipt downloads require recorded successful payments and reuse original references. Inter and unmodified static IBM Plex Sans fonts are bundled with their licenses.

## API references checked

- [React](https://react.dev/reference/react/useEffect)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [pdf-lib](https://pdf-lib.js.org/)
