# Change Record

**Title:** Return reminders before a rental's return date
**Project:** ArkiLaunch
**Date:** 2026-10-15
**Version:** 0.1
**Status:** `Applied`
**Trigger doc:** Stakeholder panel feedback, QA §2 Notifications & Alerts (Dra. Domingo)
**Docs touched:** [PRD](prd-arkilaunch.md) PRD-F8 and §5.2 top bar; [SDD](sdd-arkilaunch.md) §2 ACA Jobs and §5 API; [index.md](index.md) §2

---

## 1. Summary

Nothing warned a customer or the rental team that a machine was due back. The only countdown was the "days remaining" line on the customer's booking page, and overstays showed up only in the leakage report. This change adds automated countdown reminders before each machine's return date and one alert when it is overdue. Customers and staff see them in the notification feed and by email. Staff also see due returns on the dashboard and as badges on bookings. The approved changes below amend PRD-F8 (track transaction status) and the referenced SDD sections.

## 2. Approved behaviour changes

- **Reminder points per tenant.** Each tenant picks its points from a fixed menu: 7, 5, 3, 2 and 1 days before the return date. Overdue alerts have their own on/off switch. The baseline is 5, 3 and 1 days plus the overdue alert. A tenant with no saved settings gets the baseline. Unticking every day stops countdown reminders. Admins edit this on Business settings under Return reminders.
- **When.** The `return-reminders` ACA Job runs daily at 08:00 Manila. Days are Manila calendar days: 0 means due today and a negative count means overdue. The deadline is per machine (`equipment_assignments.end`) on a live booking (rental and assignment both `active`).
- **Which point fires.** A machine gets the tightest configured point that is still ahead of it. A booking made two days before its return therefore gets one reminder, not every point at once, and a missed run catches up the next day. Overdue alerts are sent once per machine and return date, never repeated.
- **Grouping and recipients.** One message goes out per booking per point, listing every machine due at that point. It goes to the customer's active user and to every active admin and owner of the tenant. Each user's email preference (`notification_prefs.email`) gates the email; the in-app row is always written.
- **Extensions.** Reminders are deduplicated on machine, return date and point. An approved extension moves the return date and re-arms the reminders for the new date.
- **Customer view.** The booking page countdown uses the same Manila calendar days and reads "Due in N days", "Due today" or "Overdue by N days". It no longer stops at zero.
- **Staff view.** The dashboard has a Returns due panel listing machines due within the tenant's widest point, overdue first. Each row opens its booking, and the panel is hidden when nothing is due. On-site bookings in the list, and each machine in the booking drawer, show a countdown badge inside the same window.

## 3. Data and API

Migration `0091_return_reminder_settings.sql` adds one tenant-owned table:

| Column | Type | Constraint/default |
|---|---|---|
| `tenant_id` | uuid | Primary key; references `tenants.id` ON DELETE restrict |
| `days_before` | smallint[] | NOT NULL, default `{5,3,1}`; CHECK subset of `{7,5,3,2,1}` |
| `overdue` | boolean | NOT NULL, default true |
| `updated_at` | timestamptz | NOT NULL, default now() |

RLS is enabled and forced, with a `tenant_isolation` policy for `app_authenticated` and `SELECT, INSERT, UPDATE` granted. No backfill: a missing row reads as the baseline.

| Endpoint | Permission | Behaviour |
|---|---|---|
| `GET /api/v1/bookings/return-reminders` | `report:read` (admin, owner) | The tenant's settings, or the baseline |
| `PUT /api/v1/bookings/return-reminders` | `tenant:manage` | Upserts `{ daysBefore, overdue }`. Validated by `ReturnReminderSettingsSchema`: menu days only, no repeats, no extra keys |
| `GET /api/v1/bookings/returns-due` | `report:read` | `{ windowDays, items: [{ rentalId, code, customerName, assignmentId, equipmentLabel, end, daysLeft }] }`, overdue first |

The tenant comes from the verified JWT inside `withTenantTx` (RFC-1). The job uses the job connection, which bypasses RLS, so every query names its tenant explicitly.

Notification types: `return_reminder` and `return_overdue`. The payload is `{ rental_id, booking_code, threshold, days_left, machines: [{ assignment_id, equipment_id, label, end }], audience }`.

## 4. Not in scope

- Push and SMS channels; repeated overdue alerts; custom day values outside the menu.
- No status change, charge, deposit deduction or penalty: the job only notifies.

## 5. Verification

Pre-merge evidence recorded on 2026-10-15. DB suites ran on a fresh local PostgreSQL 17 database with migrations and `db:seed:test`, following the CI `api-integration-suite` steps with external keys blanked.

| Check | Result |
|---|---|
| `pnpm lint` | Passed; two existing unused-variable warnings in `app.inventory.tsx` |
| `pnpm typecheck` | Passed |
| `@arkilaunch/shared` | 35 files, 407/407 tests passed (incl. `return-reminder.spec.ts`) |
| `@arkilaunch/web` | All files passed, incl. feed, countdown, dashboard panel and settings card tests |
| `@arkilaunch/api` | 59 files, 395/395 tests passed (incl. `return-reminders.spec.ts`). A first run had `ai-abuse.spec.ts` fail in setup; it passed alone and on a fresh-DB rerun |
| `@arkilaunch/jobs` | 8 files, 54/54 tests passed (incl. `return-reminders.spec.ts`: grouping, same-day dedup, catch-up, extension re-arm, overdue once, per-tenant points and overdue switch, tenant scoping) |
| `@arkilaunch/db` pooler-independent suites | 5 files, 30/30 tests passed; RLS enumeration covers the new table |
| Migration 0091 | Applied cleanly after 0001-0090 |
| Pre-merge agents | `migration-rls-guardian` PASS; `tenant-isolation-checker` PASS; `restraint-guardian` PASS (two nits applied) |

Browser QA has not been run yet.
