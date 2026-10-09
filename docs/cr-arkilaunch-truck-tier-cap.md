# Change Record

**Title:** Tier discount caps apply to truck trips
**Project:** ArkiLaunch
**Date:** 2026-10-07
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Owner request 2026-10-07 (make tier discount caps apply to the trucking service too)
**Docs touched:** [index.md](index.md) §2

---

## 1. Summary

Customer tier caps (UC 005) only gated equipment quotes. A truck trip's agreed price could go any distance below the route price; only the tenant's own negotiation floor (`truck_settings.max_discount_pct`) warned. The tier cap now gates the truck agreed price too.

## 2. Approved behaviour changes

- **Discount basis.** The discount is the agreed price's distance below the trip's route price (`price.totalPhp`, recomputed on confirmed km), as a percent. A price at or above the route price is no discount.
- **Within the cap.** Applies at once, as before.
- **Above the cap.** Only the Owner may set it (`PATCH /api/v1/truck-requests/:id/agree`). Anyone else gets `409 truck_cap_needs_owner` with `tier`, `capPct` and `discountPct`. There is no approval queue: the admin asks the Owner, who sets the price.
- **Overdue balance.** The cap is 0%, as on quotes.
- **Audit.** The `truck_requests` audit reason records `tier cap ok | exceeded (owner)` with the tier, discount and cap.
- **Staff drawer.** It shows the customer's tier note. The confirm dialog warns an Owner and tells an admin that only the Owner can set the price.
- **Unchanged.** The tenant negotiation floor still warns and never blocks. A trip with no linked company (legacy rows) is not tier-checked.

## 3. Data and API

No migration. It reuses `customerTier()` (`packages/db/src/customer-tier.ts`) and `discountPct()` (`packages/shared/src/tiers.ts`).

## 4. Not in scope

- An Owner approval queue for truck prices (quotes have one: `cap_status`). Add one if Owners want admins to propose over-cap prices and wait.

## 5. Verification

Run on 2026-10-07 against a throwaway local Postgres 17 (migrate + two-tenant seed):

| Suite | Result |
|---|---|
| api `truck-checkout.spec.ts`, `office-mark-paid.spec.ts` | 8 passed (the new case was also run with the seeded customer forced to bronze and to gold) |
| web `app.trucks.test.tsx` | 1 passed |

Typecheck is clean for api and web. Lint is clean on the changed files.
