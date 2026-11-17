import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  customers,
  dueAssignments,
  notifications,
  publicPhotoUrl,
  returnReminderSettings,
  roles,
  sendEmail,
  tenants,
  users,
} from '@arkilaunch/db';
import {
  DEFAULT_RETURN_REMINDERS,
  RETURN_OVERDUE_TYPE,
  RETURN_REMINDER_DAY_OPTIONS,
  RETURN_REMINDER_TYPE,
  addDaysIso,
  daysUntilReturn,
  manilaDate,
  reminderThreshold,
  renderEmailHtml,
  returnReminderEmail,
  tenantWebOrigin,
  type ReturnReminderPayload,
  type ReturnReminderSettings,
} from '@arkilaunch/shared';
import { makeJobDb } from './db-client.js';
import { runJobIfMain } from './telemetry.js';

// Notifies only: no state change and no money movement. Runs daily at 08:00 Manila.
const STAFF_ROLES = ['admin', 'owner'];
// The widest point on the menu; per-tenant settings narrow it below.
const LOOKAHEAD_DAYS = Math.max(...RETURN_REMINDER_DAY_OPTIONS);

type Mail = { email: string; subject: string; text: string; html: string };
type Group = {
  tenantId: string;
  rentalId: string;
  customerId: string;
  code: string | null;
  threshold: number | 'overdue';
  days: number[];
  machines: ReturnReminderPayload['machines'];
};

export async function runReturnReminders(now = new Date()): Promise<{ sent: string[] }> {
  const { db, client } = makeJobDb();
  const sent: string[] = [];
  try {
    // RLS is bypassed on this connection: every read and write after this names the row's tenant.
    const until = new Date(`${addDaysIso(manilaDate(now), LOOKAHEAD_DAYS + 1)}T00:00:00+08:00`);
    const due = await dueAssignments(db, until);
    console.log(`return-reminders: ${due.length} machine(s) due by ${manilaDate(until)} or overdue.`);
    if (due.length === 0) return { sent };

    const tenantIds = [...new Set(due.map((d) => d.tenantId))];
    const settingsByTenant = new Map<string, ReturnReminderSettings>(
      (
        await db
          .select()
          .from(returnReminderSettings)
          .where(inArray(returnReminderSettings.tenantId, tenantIds))
      ).map((r) => [r.tenantId, { daysBefore: r.daysBefore as ReturnReminderSettings['daysBefore'], overdue: r.overdue }]),
    );

    // Dedup on (machine, return date, point): an extension moves the date and re-arms the reminders.
    const rentalIds = [...new Set(due.map((d) => d.rentalId))];
    const seen = new Set<string>();
    const prior = await db
      .select({ tenantId: notifications.tenantId, payload: notifications.payload })
      .from(notifications)
      .where(
        and(
          inArray(notifications.tenantId, tenantIds),
          inArray(notifications.notificationType, [RETURN_REMINDER_TYPE, RETURN_OVERDUE_TYPE]),
          inArray(sql`${notifications.payload}->>'rental_id'`, rentalIds),
        ),
      );
    for (const row of prior) {
      const p = row.payload as Partial<ReturnReminderPayload>;
      for (const m of p.machines ?? []) seen.add(`${row.tenantId}|${m.assignment_id}|${m.end}|${String(p.threshold)}`);
    }

    // One message per booking per point, listing every machine due at it.
    const groups = new Map<string, Group>();
    for (const d of due) {
      const days = daysUntilReturn(d.end, now);
      const threshold = reminderThreshold(days, settingsByTenant.get(d.tenantId) ?? DEFAULT_RETURN_REMINDERS);
      if (threshold === null) continue;
      const end = d.end.toISOString();
      const key = `${d.tenantId}|${d.assignmentId}|${end}|${String(threshold)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const groupKey = `${d.tenantId}|${d.rentalId}|${String(threshold)}`;
      const group: Group = groups.get(groupKey) ?? { tenantId: d.tenantId, rentalId: d.rentalId, customerId: d.customerId, code: d.code, threshold, days: [], machines: [] };
      group.days.push(days);
      group.machines.push({ assignment_id: d.assignmentId, equipment_id: d.equipmentId, label: d.equipmentLabel, end });
      groups.set(groupKey, group);
    }

    const brandByTenant = new Map<string, { brand: { name: string; logoUrl: string | null; color: string | null }; origin: string }>();
    for (const g of groups.values()) {
      const type = g.threshold === 'overdue' ? RETURN_OVERDUE_TYPE : RETURN_REMINDER_TYPE;
      const payload: ReturnReminderPayload = {
        rental_id: g.rentalId,
        booking_code: g.code,
        threshold: g.threshold,
        days_left: Math.min(...g.days),
        machines: g.machines,
      };

      let context = brandByTenant.get(g.tenantId);
      if (!context) {
        const [tenant] = await db
          .select({ name: tenants.legalName, slug: tenants.slug, logoKey: tenants.logoKey, color: tenants.primaryColor })
          .from(tenants)
          .where(eq(tenants.id, g.tenantId))
          .limit(1);
        const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
        context = {
          brand: { name: tenant?.name ?? 'ArkiLaunch', logoUrl: publicPhotoUrl(tenant?.logoKey ?? null), color: tenant?.color ?? null },
          origin: tenant ? tenantWebOrigin(tenant.slug, webOrigin, process.env.PLATFORM_DOMAIN) : webOrigin,
        };
        brandByTenant.set(g.tenantId, context);
      }
      const { brand, origin } = context;

      const mails: Mail[] = [];
      await db.transaction(async (tx) => {
        const customer = await tx
          .select({ id: users.id, email: users.email, prefs: users.notificationPrefs })
          .from(customers)
          .innerJoin(users, and(eq(users.id, customers.userId), eq(users.tenantId, customers.tenantId)))
          .where(and(eq(customers.tenantId, g.tenantId), eq(customers.id, g.customerId), eq(users.status, 'active')));
        const staff = await tx
          .select({ id: users.id, email: users.email, prefs: users.notificationPrefs })
          .from(users)
          .innerJoin(roles, eq(roles.id, users.roleId))
          .where(and(eq(users.tenantId, g.tenantId), inArray(roles.name, STAFF_ROLES), eq(users.status, 'active')));
        const rows = [
          ...customer.map((u) => ({ ...u, audience: 'customer' as const })),
          ...staff.map((u) => ({ ...u, audience: 'staff' as const })),
        ];
        if (rows.length === 0) return;
        await tx.insert(notifications).values(
          rows.map((r) => ({ tenantId: g.tenantId, userId: r.id, notificationType: type, payload: { ...payload, audience: r.audience } })),
        );
        for (const r of rows) {
          if (!r.prefs.email) continue;
          const mail = returnReminderEmail(type, payload, r.audience, origin);
          if (mail) mails.push({ email: r.email, ...mail, html: renderEmailHtml(brand, mail.text) });
        }
      });
      sent.push(g.rentalId);

      // After commit: the in-app row is the record; a mail failure never rolls it back.
      for (const m of mails) {
        await sendEmail(m.email, m.subject, m.text, m.html).catch((err) =>
          console.error(`return-reminders: email for ${g.rentalId} failed`, err),
        );
      }
    }
    console.log(`return-reminders: notified ${sent.length} booking(s).`);
    return { sent };
  } finally {
    await client.end();
  }
}

runJobIfMain(import.meta.url, 'return-reminders', runReturnReminders);
