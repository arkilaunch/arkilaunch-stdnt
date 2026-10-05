# Change Record

**Title:** All-in hourly rate cards with a per-type operating cost breakdown
**Project:** ArkiLaunch
**Date:** 2026-10-05
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** [rfc-arkilaunch-quotation-pricing-engine.md](rfc-arkilaunch-quotation-pricing-engine.md) (equipment line formula); owner request
**Docs touched by this record:** [index.md](index.md) §change log

---

## 1. Why

The owner sets one hourly price per machine (e.g. all excavators ₱1,200/hr) and wants customers to see what is inside it. Before this change, operator, maintenance and fuel were company-wide figures added **on top** of the rate card, with the buffer added on top of that. Customers saw only one lumped "operator, fuel and upkeep" amount.

## 2. What changed

- **The rate card is the all-in ₱/hr the customer pays.** Equipment lines are `rate × hours × qty`, with no buffer.
- **New tenant table `equipment_type_costs`** (migration 0079, RLS + FORCE). Each equipment type stores operator ₱/hr, maintenance ₱/hr and fuel L/hr. The migration backfills these from each tenant's current `pricing_parameters` for every type that has a current card.
- **Breakdown** (`rateBreakdown` in `packages/shared/src/pricing.ts`): `fuel = L/hr × diesel` (the same diesel source as trucking, fixed at quote time), and `rent = all-in − operator − maintenance − fuel`. If the costs exceed the rate, the quote is refused with 422 `rate_card_costs_exceed_rate`.
- The breakdown is frozen in `pricing_inputs.rate_breakdown` (formula 3.0). Quotes issued earlier keep their own numbers and the old line text.
- **Admin:** under Rate cards, each card shows its live breakdown, and a "Costs" action edits the costs for that type. The add-card form previews the split. The company Operating costs card now holds only fuel L/km, transport ₱/km and buffer (used for mobilization and trucking).
- **Customer:** booking, negotiation and printed quote lines read "₱1,200/hr all-in (rent + operator + maintenance + fuel at ₱X/L diesel) × N hours".
- **API:** `GET` and `PUT /pricing/equipment-type-costs` (`pricing:manage`).

## 3. Not changed

- Trucking pricing.
- `pricing_parameters.operator_hourly_php`, `maintenance_hourly_php` and `fuel_l_per_hour` stay in the table, and the UI resends their saved values. They no longer price equipment lines.
