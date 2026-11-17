# Change Record

**Title:** Admin fleet counts, booking history, invoices, tickets, and company submitters
**Date:** 2026-11-11
**Status:** Applied in workspace
**Traceability:** PRD-F4 / US-04 and US-10; PRD-F6 / US-06; PRD-F8 / US-09; admin billing and support screens

## Decision

- Dashboard machine counts use the same unretired Equipment listing as the fleet page. Available means `availability_status = available`; unavailable is every other listed machine.
- A pending, undeployed equipment rental becomes `expired` after its Manila start date has passed. An unpaid truck request becomes `expired` after its exact scheduled instant. Paid rentals and paid or dispatched truck requests keep their operational status. Expired records remain in History and out of Active bookings. Existing completed and cancelled records also stay in History.
- Expiration closes unpaid invoices and pending payments and releases scheduled rental assignments. Checkout and expiration serialize on the booking row; a checkout still unpaid at the deadline expires. Checkout rejects bookings whose scheduled window has passed, including before a list read materializes the status.
- Admin invoices are classified by billed company and project site or delivery location. Each invoice shows its booking code and booking person. Invoice actions and accounting records are unchanged.
- Registration review shows the submitter's name and email in the queue, with phone in the review detail. A login can submit several companies without losing the identity of the submitter.
- Ticket controls and text wrap within their table cells and dialogs at narrow and wide widths.

## Implementation and verification

The status is materialized on booking list and detail reads inside the tenant transaction. This keeps the admin's Active and History views current when opened. The existing hourly hold-expiry job can still cancel a pending rental before its start date; that cancelled record appears in History. Migration 0094 expands the truck status CHECK constraint to include `expired`; rental status is already unconstrained text. The migration changes no rows or RLS policy and must run before the API writes the new status. A rollback must keep a release that understands `expired` as closed, or first preserve expired identifiers and transition them to `cancelled` in a controlled transaction before redeploying a pre-expiration API. Do not simply redeploy the old API against expired rows. Read and write queries remain tenant scoped.

Date boundary tests cover the Manila rental day and exact truck instant. Dashboard, invoice grouping and registration UI tests passed, as did both rental and truck expiration database cases, workspace typecheck and production build. Migration 0094 was applied to the connected Supabase instance on 2026-11-11 after confirming it was the only pending migration. The Drizzle journal and database constraint were verified afterward. The complete workspace test run exposed a quotation tier-cap fixture failure (`pending_owner` versus `within`) unrelated to this diff; the cancelled-booking response regression it also exposed was fixed and its focused test passed. Playwright ticket checks could not start because `almara.localhost` does not resolve in this environment. TanStack search validation and query options were checked against the [Router search parameter guide](https://tanstack.com/router/latest/docs/guide/search-params) and [Query options guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-options).
