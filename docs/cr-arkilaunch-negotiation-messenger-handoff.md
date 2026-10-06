# Change Record

**Title:** Negotiation moves to Messenger; in-app chat behind a flag
**Project:** ArkiLaunch
**Date:** 2026-10-06
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Owner request 2026-10-06 (disable in-app negotiation by default and send customers to the tenant's Messenger with their billing details on the clipboard)
**Docs touched:** [dsd-arkilaunch.md](dsd-arkilaunch.md) Trip Card (and materialized `DESIGN.md`); [index.md](index.md) §2; amends the Messenger-or-in-app choice from [cr-arkilaunch-qa-batch-14-22.md](cr-arkilaunch-qa-batch-14-22.md)

---

## 1. Summary

Customers negotiated in an in-app chat next to the quote. If the tenant had a Messenger link, they could pick Messenger or in-app chat first. For now the owner wants negotiation to happen in Messenger only. A new web flag turns the in-app chat off by default. Negotiate then:

1. copies the booking's (or truck request's) billing details as a polite, ready-to-paste message;
2. shows a popup saying the details were copied, with the text itself;
3. opens the tenant's Messenger in a new tab after 5 seconds, or at once from a button.

The price still only binds through the in-app quote. Whatever is agreed on Messenger comes back as a revised quote for the customer to accept, so the money path is unchanged (RFC-2).

## 2. Approved behaviour changes

- **Flag.** `VITE_ENABLE_IN_APP_NEGOTIATION` (web build env). The chat is on only when it is `'true'`, so it is off by default. It is read in one place: `inAppNegotiation()` in `apps/web/src/components/negotiation-thread.tsx`. The API message endpoints stay live.
- **Messenger link.** This is the existing per-tenant `tenants.messenger_url`, and no new setting is added. For Almara it is `https://m.me/almaraconstructioncorp`. An `m.me` link opens the chat itself, while a facebook.com page link only opens the page.
- **Clipboard message.** It starts with a greeting to the tenant and the line "(Pasted from the {Tenant} booking system)".
  - **Bookings:** booking code, customer name, site city/province, site contact and mobile, each machine with its dates, and the quote revision with mobilization, demobilization and total. The quote line is left out while the quote is still being priced.
  - **Truck requests:** code, requester/company, route, date, load, and the price with its agreed/estimated note.
- **Popup.** The popup shows the copied text and a countdown, "Opening Messenger in N…", plus **Open Messenger now** and **Cancel** buttons.
  - A timer-fired `window.open` has no user gesture, so a browser may block it. Safari always does. When that happens, the popup stays open and says so, and the button opens Messenger.
  - If the clipboard write fails, the popup shows the text with a copy button and does not redirect on its own.
- **With the flag off:**
  - **Customer booking page:** the thread is replaced by a "Talk to the rental team" card. The quote card's Negotiate button and the cart's "Negotiate via messenger" button both run the handoff.
  - **Truck request drawer:** the thread is hidden, and the section is titled "Negotiate the price".
  - **Staff:** the booking drawer's Negotiation tab and the full-page thread are hidden. A link to that tab lands on Overview.
  - **No Messenger link on the tenant:** bookings go to the phone page (`/account/negotiation/$bookingId/call`), and truck requests go to `/contact`.
- **With the flag on:** behaviour is as before, except the Messenger option now runs the same copy-and-handoff.

## 3. Data and API

No migration, endpoint or RLS change.

Almara's `messenger_url` must hold the `m.me` link. It is set through tenant settings, which is a data change and is not part of this code change.

## 4. Not in scope

- Turning off the negotiation API endpoints.
- Pre-filling the Messenger message. `m.me` links cannot carry text, which is why the clipboard is used.
- Changing how a negotiated price becomes binding.

## 5. Verification

Run on 2026-10-06:

| Check | Result |
|---|---|
| web vitest (full) | 88 files, 547 passed |
| web `tsc --noEmit` | clean |
| eslint (changed files) | clean |

New tests:
- `apps/web/src/components/negotiate-choice.test.tsx` covers the copy, the popup, the 5 s redirect, a blocked tab, Cancel, a failed copy, the no-link fallback, and the flag-on choice.
- `apps/web/src/lib/messenger-message.test.ts` covers the message builders.
- `account.negotiation.test.tsx` adds a flag-off case.

e2e: `playwright.config.ts` starts the dev server with the flag on, because the journeys drive the in-app chat.
