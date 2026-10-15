# Change Record

**Title:** Rental agreement signed at checkout: typed name and drawn signature
**Project:** ArkiLaunch
**Date:** 2026-10-15
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Stakeholder panel feedback, QA §3 User Experience & Account Onboarding, "Contractual Compliance" (Mr. Violeta)
**Docs touched:** [index.md](index.md) §2. The [SDD](sdd-arkilaunch.md) `rental_contracts.terms_ref` column is still unused; signing evidence lives in the new `rental_agreements` table.

---

## 1. Summary

Before this change, checkout carried one passive line: "By paying you agree to the rental agreement." It linked to a placeholder `/terms` page, and nothing was signed or stored.

Now the customer reads the rental company's agreement on the checkout page and signs it before any payment starts. Signing takes three things: tick the box, type the full name, and draw a signature. The server keeps an append-only record of exactly what was signed.

## 2. Approved behaviour changes

- **Tenant-editable text.** Admins edit the agreement under Business settings, in the Rental agreement card. Each save creates a new version (`v1`, `v2`, …).
  - A tenant with no saved text uses the platform template (`default-1`). The template is a draft based on the thesis lessee terms and is labelled for counsel review.
- **Signing at checkout.** Pay now and Get invoice stay disabled until three things are done: the box is ticked, a name of 2–120 characters is typed, and at least one stroke is drawn on the signature pad.
  - The pad is a native canvas that accepts mouse, touch and pen. It exports a PNG of at most 600×200.
- **Once per quotation.** A booking is signed once for its current quotation. A retry or a switch of payment method needs no new signature. A revised quote has a new quotation id, so the customer signs again.
- **Stale text.** If the tenant changes the text while a customer is on the checkout page, the server answers 409 `terms_changed`. The page then reloads the new text and asks for the signature again.
- **Office payments.** Staff marking a booking paid at the office (`mark-paid`) skip the electronic step. The paper agreement covers that case.
- **Visibility.** The customer's booking page and the staff booking drawer show the signer's name, the date, the terms version and the signature image.

## 3. Data and API

Migration `0092_rental_agreements.sql`:

| Table | Purpose | Grants |
|---|---|---|
| `rental_terms_settings` | `tenant_id` PK, `body` (≤ 50,000 chars), `version`, `updated_by`, `updated_at` | SELECT, INSERT, UPDATE |
| `rental_agreements` | `rental_id`, `quotation_id` (null for a deposit-only booking), `customer_id`, `user_id`, `terms_version`, `terms_body` (snapshot), `signed_name`, `signature_png` (≤ 140,000 chars), `signed_at`, `ip`, `user_agent` | SELECT, INSERT only (append-only) |

- Both tables have RLS enabled and forced, plus a `tenant_isolation` policy.
- No backfill: bookings paid before this change have no agreement row.

| Endpoint | Permission | Behaviour |
|---|---|---|
| `GET /api/v1/bookings/rental-terms` | `booking:read` | `{ version, body, isDefault }`: the tenant's text, or the template |
| `PUT /api/v1/bookings/rental-terms` | `tenant:manage` | `{ body }` (200–50,000 chars). Bumps the version and writes an audit log |
| `POST /api/v1/bookings/:id/checkout` | `payment:checkout` | New optional `agreement: { signedName, termsVersion, signaturePng }`. Required when the current quotation is unsigned: 409 `agreement_required`, or 409 `terms_changed` if the version is stale. `signaturePng` must be a `data:image/png;base64,` URL whose bytes start with the PNG signature |
| `GET /api/v1/bookings/:id` | `booking:read` | New `agreement: { signedName, signedAt, termsVersion, signaturePng } \| null` |

The tenant comes from the verified JWT (RFC-1). IP is `req.ip` (one trusted proxy hop) and the user agent is truncated to 500 characters.

## 4. Not in scope

- Truck-trip and standalone invoice checkouts.
- Publishing tenant text on the public `/terms` page.
- Storing the sign-up Terms of Service checkbox.
- A downloadable signed PDF.
- Legal review of the template (E8 in [clr-arkilaunch.md](clr-arkilaunch.md)).

## 5. Verification

Pre-merge evidence recorded on 2026-10-15 on a fresh local PostgreSQL 17 database (migrations plus `db:seed:test`, external keys blanked).

| Check | Result |
|---|---|
| `apps/api` `rental-agreement.spec.ts` | Checkout refused unsigned; one row recorded with snapshot, IP and user agent; retry adds none; tenant versions bump and stay per tenant; stale version refused; signature must be a PNG within the cap |
| `apps/api` existing checkout specs | Pass with a signed fixture |
| `apps/web` `account.checkout.test.tsx`, `signature-pad.test.tsx`, `app.settings.test.tsx` | Pass |
