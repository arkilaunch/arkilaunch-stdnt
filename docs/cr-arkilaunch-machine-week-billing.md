# Change Record

**Title:** Per-machine rental deposits, closed weekly billing, usage-only extensions and rental documents

**Project:** ArkiLaunch

**Date:** 2026-11-15

**Status:** Dev migration applied; remaining money-path and browser verification pending rollout

**Trigger:** Owner-approved billing and Admin Bookings requirements, 2026-11-15

**Amends:** [PRD](prd-arkilaunch.md) F2/F3/F8, [SDD](sdd-arkilaunch.md) billing data and API, [DSD](dsd-arkilaunch.md) document and switch pattern, [QAD](qad-arkilaunch.md) money-path acceptance.

## Decision

- A new rental freezes a consumable deposit for each assigned equipment ID at quote acceptance. The tenant percentage applies to that machine's quoted hours and rate; a zero percentage uses the tenant minimum for each machine. The booking invoice lists each deposit separately. Existing rentals retain their historical shared deposit and payment history.
- Admin approval of an extension changes only that machine's assignment dates and booked hours. It creates no extension fee, checkout request or second deposit. Approved EDTR use on the added days draws from that machine's funded balance; excess becomes weekly rent.
- A rental is one job-site ID. Each closed Monday to Sunday week has one shared weekly invoice for all of its machines, or a deposit-covered rundown without an amount payable. Equipment IDs and serial numbers remain on deposit and usage rows. A payment on the shared invoice is allocated to its machine charges by amount, in cents.
- The invoice header shows date, company, equipment and job site. The billing statement has numbered rows, particulars and week period, quantity, unit, unit price and amount. Weekly gross usage is followed by deposit applied by machine and net payable. Booking deposits and other upfront charges use item units.
- A week closes only after Sunday when each scheduled machine-day is approved or staff gives an explicit reason for no work. The close saves company/site and machine/rate/amount snapshots. Later EDTR approval for that week needs a reason and creates a separately labeled correction invoice when payable; the original invoice stays unchanged.
- Rental checkout coupons do not apply because the upfront booking invoice contains deposit and delivery charges, not weekly rent. The checkout screen hides the coupon field. Staff amount adjustments cannot reduce a deposit line. Truck-service coupon handling remains available.
- Admin Bookings uses the same shared compact Active/Past switch as Customer truck requests for both service views. Its bucket URLs, tables, filters and drawer remain available.

## Data and rollout

Migration 0096 adds `rentals.deposit_mode` with historical rows defaulting to `shared`, `rental_equipment_deposits`, `rental_billing_weeks`, `invoices.billing_week_start`, and `invoice_line_items.equipment_id`. New tables have tenant RLS. Deposit and week writes validate tenant references; closed-week snapshots reject edits or deletion. Deploy the additive migration before the API and job builds. The prior code can ignore the new columns and tables for rollback.

Paid historical extension invoices are preserved. The tenant-admin cleanup action checks or expires pending provider sessions before voiding an issued historical extension invoice; a paid or unconfirmed session is skipped. Run that action for each tenant as the rollout step, then inspect skipped invoice IDs before retrying. Do not void extension invoices with a raw SQL migration.

## Verification

Required proof: same-site multi-machine week, separate rentals at different site IDs, identical models with distinct serial numbers, minimum and percentage deposits, deposit exhaustion without cross-machine coverage, partial shared-invoice payment allocation, extension-day EDTR usage, Sunday and missing-day closure gates, late correction after a paid invoice, legacy shared-deposit rentals, coupon/adjustment/refund integrity, provider-session race, tenant isolation, screen/PDF parity, and Active/Past desktop/phone behavior.

Local typecheck, production build, focused shared logic tests, invoice PDF tests, and focused web tests pass. On 2026-11-15, `pnpm db:migrate` applied migration 0096 to the configured dev Supabase project (`ydalnvzyeseycdakofgp`). A read-only check confirmed the migration ledger watermark, all five new schema elements, and enabled/forced tenant RLS on both new tables. The deposit-ledger database test passes. Full money-path and responsive-browser verification remain rollout gates.

A partial upfront refund reduces funded deposit by prorating the invoice's net paid amount across its original lines in cents. The same funded amount controls EDTR deductions, deposit balance and SOA rows. A refund after deposit has already been consumed can leave historical deductions above the newly funded amount; staff must review that refund and any correction billing.
