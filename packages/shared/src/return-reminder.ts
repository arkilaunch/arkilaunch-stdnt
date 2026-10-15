import { z } from 'zod';
import { manilaDate } from './edtr.js';

// The day points a tenant can tick; a tenant with no settings row gets the default.
export const RETURN_REMINDER_DAY_OPTIONS = [7, 5, 3, 2, 1] as const;
export type ReturnReminderDay = (typeof RETURN_REMINDER_DAY_OPTIONS)[number];

export const ReturnReminderSettingsSchema = z
  .object({
    daysBefore: z
      .array(z.literal(RETURN_REMINDER_DAY_OPTIONS))
      .max(RETURN_REMINDER_DAY_OPTIONS.length)
      .refine((days) => new Set(days).size === days.length, 'Each day can be picked once'),
    overdue: z.boolean(),
  })
  .strict();
export type ReturnReminderSettings = z.infer<typeof ReturnReminderSettingsSchema>;

export const DEFAULT_RETURN_REMINDERS: ReturnReminderSettings = { daysBefore: [5, 3, 1], overdue: true };

export const RETURN_REMINDER_TYPE = 'return_reminder';
export const RETURN_OVERDUE_TYPE = 'return_overdue';

// Manila calendar days from today to the return date: 0 is due today, negative is overdue.
export function daysUntilReturn(end: Date | string, now: Date = new Date()): number {
  const today = manilaDate(now);
  const due = manilaDate(end);
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

// The tightest configured point still ahead, so a missed run or a late booking sends one reminder, not every point.
export function reminderThreshold(days: number, settings: ReturnReminderSettings): number | 'overdue' | null {
  if (days < 0) return settings.overdue ? 'overdue' : null;
  const ahead = settings.daysBefore.filter((d) => d >= days);
  return ahead.length > 0 ? Math.min(...ahead) : null;
}

// How far ahead staff should see due returns: the widest configured point (due today when none).
export function returnWindowDays(settings: ReturnReminderSettings): number {
  return settings.daysBefore.length > 0 ? Math.max(...settings.daysBefore) : 0;
}

export function returnDueLabel(days: number): string {
  if (days < -1) return `overdue by ${-days} days`;
  if (days === -1) return 'overdue by 1 day';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

export interface ReturnReminderMachine {
  assignment_id: string;
  equipment_id: string;
  label: string;
  end: string; // ISO timestamp
}

export interface ReturnReminderPayload {
  rental_id: string;
  booking_code: string | null;
  threshold: number | 'overdue';
  days_left: number;
  machines: ReturnReminderMachine[];
  audience?: 'customer' | 'staff';
}

export interface ReturnDueRow {
  rentalId: string;
  code: string | null;
  customerName: string | null;
  assignmentId: string;
  equipmentLabel: string;
  end: string;
  daysLeft: number;
}

export interface ReturnsDueResponse {
  windowDays: number;
  items: ReturnDueRow[];
}

const day = (iso: string) =>
  new Date(`${manilaDate(iso)}T00:00:00Z`).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

const SIGN = '\n\n-- ArkiLaunch';

export function returnReminderEmail(
  type: string,
  payload: ReturnReminderPayload,
  audience: 'customer' | 'staff',
  origin: string, // the tenant's web origin (tenantWebOrigin)
): { subject: string; text: string } | null {
  if (type !== RETURN_REMINDER_TYPE && type !== RETURN_OVERDUE_TYPE) return null;
  const base = origin.replace(/\/$/, '');
  const ref = payload.booking_code ?? 'your booking';
  const when = returnDueLabel(payload.days_left);
  const lines = payload.machines.map((m) => `- ${m.label}: return by ${day(m.end)}`).join('\n');
  const overdue = type === RETURN_OVERDUE_TYPE;

  if (audience === 'customer') {
    return {
      subject: overdue ? `${ref} is past its return date` : `Return reminder: ${ref} is ${when}`,
      text:
        (overdue
          ? `These machines on ${ref} are past their return date. Please return them or ask us for an extension.`
          : `These machines on ${ref} are ${when}. Need them longer? Request an extension before the return date.`) +
        `\n\n${lines}\n\nView booking: ${base}/account/bookings/${payload.rental_id}${SIGN}`,
    };
  }
  const open = payload.booking_code
    ? `${base}/app/bookings?open=${encodeURIComponent(payload.booking_code)}`
    : `${base}/app/bookings/${payload.rental_id}`;
  return {
    subject: overdue ? `Overdue return: ${ref}` : `Return ${when}: ${ref}`,
    text: `${overdue ? 'Machines not yet returned' : `Machines ${when}`} on ${ref}:\n\n${lines}\n\nOpen ${ref}: ${open}${SIGN}`,
  };
}
