# Change Record

**Title:** Rental workflow QA, tenant storefront promotions, and consistent documents
**Date:** 2026-10-20
**Status:** In progress
**References:** PRD-F4/F7/F8; SDD data/API; DSD storefront/dialog/print; QAD money paths.

## Approved changes

The owner approved the implementation plan on 2026-10-20. Signing moves into the existing accessible modal with a compact checkout status, explicit confirmation, preserved drafts, and invalidation on changed terms/quotation. Returns record good condition, normal wear, servicing, or damage while retaining notes. Servicing/damage keep equipment unavailable. Staff prepare damage assessments against the signed agreement; Owner alone approves invoices, with no automatic deposit deduction. Individual deployment uses booked dates; bulk deployment includes due units only. Tenant storefronts receive a refreshed service layout and optional manually configured promotional starting prices, separate from quotation calculations.

All existing PDF and print outputs receive consistent tenant branding, measured wrapping and pagination. Add invoice, successful-payment receipt, and signed-snapshot agreement downloads. Preserve all existing arithmetic and the EDTR scanning layout. Additive migrations precede application rollout; old clients remain compatible.

## Verification

Pending implementation and focused, integration, browser, and visual checks. Required tenant-isolation, migration/RLS, and restraint reviews will be recorded here and in the PR.

## API references checked

- [React](https://react.dev/reference/react/useEffect)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [pdf-lib](https://pdf-lib.js.org/)
