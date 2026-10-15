# Change Record

**Title:** Deferred customer verification: browse, price and fill a cart before KYC
**Project:** ArkiLaunch
**Date:** 2026-10-15
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Stakeholder panel feedback, QA §3 User Experience & Account Onboarding, "Deferred Verification Workflow" (Mr. Violeta)
**Docs touched:** [index.md](index.md) §2. Supersedes the price gate (commit `e92ebc6`, no prior CR) and the cart-side verification gate in [cr-arkilaunch-cart-validation.md](cr-arkilaunch-cart-validation.md) §2.

---

## 1. Summary

The panel asked that a new customer browse the catalog right after sign-up and verify their company later, before a rental is finalised. Sign-up never checked KYC itself. The friction was everything after it:

- Sign-up sent the customer straight into the new-company wizard.
- Prices were hidden until a company was KYC-approved.
- Rent buttons read "Verify to rent".
- The cart refused to open for a company still awaiting verification.

This change moves the customer-facing gate to the moment the booking request is sent. The server gates are unchanged.

## 2. Approved behaviour changes

- **Sign-up lands on the catalog.** After creating an account the customer goes to `/equipment`, not `/account/companies/new`. The account banner now reads "Add your company when you are ready to book."
- **Prices are public.** The public catalog (`GET /catalog/equipment`, `/catalog/equipment/:id`) returns `rateValue` to anyone, signed in or not. `GET /catalog/rates` and its `kyc_required` 403 are removed. A machine without a published rate shows "Price on request".
- **No rent lock.** "Rent this unit" and "Book now" add to the cart for any signed-in customer. "Verify to rent" is gone.
- **The cart accepts a pending company.** A company awaiting verification can be picked, and the customer can fill in dates, site and contact. A note under the company field links to "Finish verification". On submit the request is stopped with that note as an alert, and the cart stays saved. A rejected company still cannot be picked.
- **Unchanged server enforcement.** These still require a KYC-approved company:
  - `POST /bookings` (`requireVerifiedCompany`, 409 `company_not_verified`)
  - quote create and revise
  - rental and truck checkout

  So no booking request, quote or payment happens before verification.

## 3. Data and API

- No migration.
- Removed: `GET /api/v1/catalog/rates`, `listCatalogRatesForSlug`, and `CatalogRateListResponseSchema`.
- The catalog SQL functions already expose `rate_value` in their allowlist. The API simply stops nulling it.

## 4. Not in scope

- Booking requests from an unverified company stay refused, by design: KYC blocks the request at cart submit.
- A per-tenant "hide prices" switch is not added. Add one if a tenant asks to keep its rate card private.

## 5. Verification

Pre-merge evidence recorded on 2026-10-15 on a fresh local PostgreSQL 17 database (migrations plus `db:seed:test`, external keys blanked).

| Check | Result |
|---|---|
| `apps/api` `catalog-prices.spec.ts` | Anonymous caller gets rates; another tenant's slug 404s |
| `apps/api` `customer-onboarding.spec.ts` | Booking and quote still refused while unverified |
| `apps/web` `account.cart.test.tsx` | Pending company fills the cart, submit raises the verification alert |
| `apps/web` `storefront.test.tsx`, `cart-validation.test.ts`, `equipment.shell.test.tsx` | Pass |
| `pnpm -r typecheck`, `pnpm -r lint` | Clean |
