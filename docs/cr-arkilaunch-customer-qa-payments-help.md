# Change Record

**Title:** QR Ph checkout and customer support tickets
**Project:** ArkiLaunch
**Date:** 2026-10-05
**Version:** 0.1
**Status:** `Applied` (verified; existing repository lint failure recorded below)
**Trigger doc:** Customer QA batch, findings #16, #17 and checkout/help portion of #18
**Docs touched:** PRD-F2 method list amendment recorded here; [sdd-arkilaunch.md](sdd-arkilaunch.md) section 5.1; [report-figma-route-alignment.md](report-figma-route-alignment.md)

---

## 1. Summary

Offer QR Ph only for online checkout until other channels are activated on the PayMongo account. Keep staff-recorded cash unchanged. Add customer support submission and ticket tracking inside the account shell, with tenant staff management and in-app notifications.

## 2. Findings and root causes

- #16: the shared method list exposed channels that the account could not accept. Checkout defaulted to GCash and narrowed the provider session to that unavailable channel. Provider rejection returned an unsafe generic error.
- #17: tickets had no persistence, API or backed screen. Payment failure linked to public contact, which redirects to the landing page on the platform host and exits the account shell on tenant hosts.
- #18: these flows need mobile controls, readable cards and a scrollable editing modal.

## 3. Approved behaviour changes

This record amends PRD-F2 and US-08's channel list to **"QR Ph only until other channels are activated on the PayMongo account"**. The single shared `CHECKOUT_METHODS` list governs accepted online methods and provider defaults. Re-enabling a channel is a one-line list edit, with its UI label and acceptance tests updated at that time. Cash remains unchanged. Hosted checkout captures payment credentials; provider verification remains the only source of payment success.

Provider HTTP rejection returns `payment_provider_rejected` with safe text; provider outages return `payment_provider_unavailable`. No raw provider response reaches a client.

Payment failure opens `/account/help` with the booking ID. Existing provider return URLs carry the invoice ID, which the failure screen resolves through the customer's own invoice endpoint. Invalid or inaccessible booking parameters are ignored gracefully.

## 4. Support data and API

Add migration `0081_support_tickets.sql`: tenant ID, tenant-unique human code, creator, optional rental booking, fixed category, subject (1-120), message (1-4000), staff-set priority, status, optional staff assignee and timestamps. RLS is enabled and forced with canonical USING/WITH CHECK for `app_authenticated`; grants permit SELECT/INSERT/UPDATE, with no deletion endpoint or DELETE grant.

Codes use a tenant-keyed transaction advisory lock followed by count + 1, formatted `ST-0001`. Allocation and insertion occur in the same tenant transaction; rollback releases the lock. The no-delete policy preserves monotonic allocation. Tenant/code uniqueness is the database backstop.

Customer endpoints: POST/GET `/me/tickets`, GET `/me/tickets/:id`. Customer-only service checks and creator ownership accompany tenant RLS. Booking attachments must belong to that customer.

Staff endpoints: GET `/tickets` (subject/code search, status and paging), GET/PATCH `/tickets/:id`. Reuse `user:manage`, already held by tenant admin/owner for people management, with service role checks. Assignments permit active same-tenant admin/owner users, matching the existing support staff notification audience. No roles or permissions are added. Any defined status may transition to any other defined status, as authorized by the brief; duplicate status updates emit no additional notification.

Use existing `notifyStaff` on creation and `notifyUser` on status change inside the transaction. Notification feed links open the backed support screens. Messages render as plain text.

## 5. UI and scope

`/account/help`: category, subject, message, submit, ticket-code confirmation, own tickets, and tenant-configured Messenger/Email. Booking links preset Payment when the own booking is valid. `/app/tickets`: required columns, search/filter, paging, view/edit/resolve, table-to-cards and existing modal. Append navigation entries. Public `/help` keeps contact details and links to login with a return destination.

No knowledge-base search, category articles, top articles, network status, print/download controls, cart, KYC or negotiation changes.

## 6. Verification and rollback

Shared validation, safe provider rejection, API ownership/isolation/concurrency/notifications, web form/table and browser workflows are covered by new tests. Static migration, tenant isolation and restraint reviews passed.

Verification on 2026-10-05:

- `pnpm.cmd install`, local migration and both anchor/two-tenant seeds completed. Database URLs were checked as localhost port 5444 before any migration or QA writes.
- `pnpm.cmd test --maxWorkers=1 --no-file-parallelism`: all 177 test files and 1,265 tests passed across shared, weather, document intelligence, DB, web, jobs and API. The initial concurrent run had database timeouts; the serialized retry resolved them. The redirected PowerShell wrapper returned a nonzero exit despite every package reporting passed/Done; the retained log contains no failed test summary.
- `pnpm.cmd typecheck`: passed. `pnpm.cmd --filter web build` and `pnpm.cmd --filter api build`: passed. The web build retains the existing large-chunk warning.
- `pnpm.cmd lint`: eight pre-existing `no-undef` errors in untouched `scripts/capture-platform-preview.mjs` (URL, Buffer, sessionStorage, localStorage and document); no changed-file lint errors. That unrelated script is outside this change.
- `pnpm.cmd --filter web e2e support-payments.spec.ts --project=desktop --project=mobile --workers=1`: 12 passed. Widths 360, 375, 390, native Pixel 5 width 393, 430 and 1440 were exercised in both projects. QR-only checkout, safe provider rejection, failed-payment help, validation, real ticket submission/listing, staff view/edit/filter/resolve, customer status visibility, invalid booking and back navigation passed. Long messages and contained/scrollable modals were exercised; horizontal overflow assertions passed. Screenshots are retained locally under ignored `test-results/pd-evidence`.
- With a verified test-key prefix and ENABLE_PAYMENTS=true, exactly one real PayMongo test checkout session was created. Its hosted page showed QR Ph only; a read of that same session confirmed `payment_method_types: ["qrph"]` and zero payments. Existing quote acceptance and call-confirmation endpoints prepared the local seed booking; no payment precondition was changed. Provider polling left the invoice `issued`, correctly unpaid. No live session, simulated successful payment or fabricated settlement was performed. A public webhook delivery/full paid return remains unverified because the local test session was deliberately left unpaid.

Earlier browser retries encountered login/loading failures during concurrent database test activity. The final complete browser run above passed after that activity finished. No application guard was weakened to make QA pass.

Rollback: deploy the prior app build; leave the additive table in place. Restore online methods only after account activation is confirmed. Existing booking payment preconditions and settlement gates remain unchanged.

## 7. Sources

- [PayMongo checkout session resource](https://docs.paymongo.com/reference/checkout-session-resource), [QR Ph](https://docs.paymongo.com/docs/payment-acceptance-qr-ph).
- [Drizzle RLS](https://orm.drizzle.team/docs/rls), [React reference](https://react.dev/reference/react).
- Locked RFC-001 tenant transactions and DSD existing controls/table/modal conventions.
