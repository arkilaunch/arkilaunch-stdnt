# Change Record

**Title:** Customer mobile rental transaction navigation and reachable actions
**Project:** ArkiLaunch
**Date:** 2026-10-05
**Version:** 0.1
**Status:** `Applied` (implementation complete in the package branch; integration review pending)
**Trigger doc:** Customer QA finding #18; PRD-F1 / PRD-F8; DSD mobile single-column layout, 360px baseline and 44px touch targets
**Docs touched by this record:** This record only. Index registration is deferred to integration.

---

## 1. Why

The mobile rental journey exposed the same transaction as desktop, but its next actions were difficult to find. Full per-item calendars pushed the cart total and quote request below a long form, the drawer omitted Cart, and the conversation appeared before the quote acceptance action. Negotiate also targeted an ID that did not identify its message field. Configure Rental inherited automatic focus on its first date control.

## 2. Decisions

- Below `md`, keep the existing estimated rent and quote submission in a fixed bottom action bar, with safe-area padding and reserved content space. Use the existing form, validation, loading state and computed total.
- Fold valid selected dates into a compact summary with Edit dates. Keep incomplete or invalid dates expanded. Choosing the first range endpoint keeps editing open; choosing the second completes the range. Desktop retains its date controls and calendar.
- Add customer Cart to the existing navigation group, including the desktop sidebar. Preserve the rest of the navigation configuration.
- Configure Rental opts out of first-control autofocus. Initial focus stays on the dialog container; Tab trapping, Escape and focus restoration remain active. Other modals retain their defaults.
- Below `lg`, place the quote above the conversation. Preserve the desktop columns and the customer tier note and offer restrictions introduced by the updated base.
- Share the message field ID between the thread and Negotiate action.
- Use 44px minimum height for every navigation-group link. Keep long site labels inside the mobile logistics grid, reserve input scroll clearance above the fixed action bar, and separate equipment names from Remove on narrow screens.
- Keep undated items expanded and display a date-selection prompt instead of invalid date metadata. Withhold their preview until dates exist and compare state values with `Object.is` to avoid repeated updates for `NaN`. Valid-date pricing formulas and submission validation are unchanged.

## 3. What changed

Frontend components, cart and negotiation routes, customer navigation, unit tests, and Playwright coverage. The responsive matrix targets the equipment model-name button and checks the catalog, detail, cart and negotiation routes. Journey tests use the local seed customer and calendar availability, request and accept a real quote, reach the existing phone-confirmation gate, and cancel only their own unpaid test booking afterward.

No API, schema, migration, price calculation, availability rule, payment gate, Messenger fallback or finalised-button style changes are part of this record. Migrations 0079 and 0080 are inherited from origin/dev, not introduced by this package.

## 4. Validation

The final browser matrix passed 20/20 cases across desktop and Pixel 5 projects: native device viewports, 360, 375, 390, 430, 844px landscape, 1440px desktop, and the 360/768/1440 responsive matrix. It exercises real local booking, quote acceptance and checkout, with overflow, focus, quote/thread order, drawer navigation, date editing, selected action dimensions, sticky-bar clearance and browser Back/Forward assertions. Screenshots were inspected for the affected layouts. An earlier desktop acceptance timeout passed in the final rerun.

A final 360px smoke rerun after the undated-item presentation guard passed 2/2 cases across both projects.

The web suite passed 483/483 tests. The cart and negotiation regression files passed 10/10 tests after the final undated-item presentation fix. Coverage includes multiple items with independent date editing, incomplete dates, invalid hours, empty cart, and pending quotes. Modal tests preserve default autofocus and prove opt-out focus trapping/restoration. Lint, frontend build and repository typecheck passed after removing an unsupported test-query option.

The full repository command remains failed: the last run passed shared 296, weather 20, document-intelligence 17, database 66 and web 483 tests, but jobs passed 45/46 with QAD-T17's last-known alert ID assertion failing. API tests reported customer-onboarding duplicate-ID scoring, three OCR abuse fixture cases and a weather-business-journey review assertion before the repository command terminated; an aggregate API pass count was not produced. API, jobs and database source files are identical to origin/dev. Their local fixture/interference causes are not established by this frontend package, and no out-of-scope repair was made. The all-tests acceptance gate remains blocked.

The inherited database package passed all 66 tests repeatedly and has no diff from origin/dev. Its earlier sandbox startup failure was environmental, not a package database-code regression. The seed backhoe card is below migration 0079's inherited costs and cannot autoquote; browser journeys use the existing quotable Komatsu PC200 instead. No seed rates or costs were changed.

Implementation follows the existing component patterns and native focus APIs. References: [React effect cleanup](https://react.dev/reference/react/useEffect), [Tailwind responsive variants](https://tailwindcss.com/docs/responsive-design), and [WAI-ARIA modal focus guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## 5. Risks and rollback

Safe-area padding is implemented with `env(safe-area-inset-bottom)`; emulated Chromium does not establish physical iOS-device behavior. Browser dimensions were checked for Add to cart, Cart, Edit dates, Request a quote and Accept quote, not every existing control. The shared calendar still has inherited 40px minimum-height targets; universal 44px compliance is not claimed. Multi-item editing is covered by unit tests, while the real booking journey uses one machine. Existing pricing and eligibility errors remain authoritative. Revert this package's frontend commit to restore the prior presentation; no data rollback is required.
