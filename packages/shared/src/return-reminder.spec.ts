import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETURN_REMINDERS,
  ReturnReminderSettingsSchema,
  daysUntilReturn,
  reminderThreshold,
  returnDueLabel,
  returnReminderEmail,
  returnWindowDays,
  type ReturnReminderPayload,
} from './return-reminder.js';

// 2026-10-15 09:00 Manila.
const now = new Date('2026-10-15T01:00:00Z');

describe('daysUntilReturn', () => {
  it('counts Manila calendar days, not 24-hour blocks', () => {
    expect(daysUntilReturn('2026-10-15T09:00:00Z', now)).toBe(0); // 17:00 Manila today
    expect(daysUntilReturn('2026-10-15T16:30:00Z', now)).toBe(1); // 00:30 Manila tomorrow
    expect(daysUntilReturn('2026-10-20T09:00:00Z', now)).toBe(5);
    expect(daysUntilReturn('2026-10-14T09:00:00Z', now)).toBe(-1);
  });

  it('rolls the day over at Manila midnight', () => {
    const lateNight = new Date('2026-10-15T15:59:00Z'); // 23:59 Manila
    const pastMidnight = new Date('2026-10-15T16:01:00Z'); // 00:01 Manila next day
    expect(daysUntilReturn('2026-10-18T09:00:00Z', lateNight)).toBe(3);
    expect(daysUntilReturn('2026-10-18T09:00:00Z', pastMidnight)).toBe(2);
  });
});

describe('reminderThreshold', () => {
  it('picks the tightest configured point still ahead', () => {
    expect(reminderThreshold(5, DEFAULT_RETURN_REMINDERS)).toBe(5);
    expect(reminderThreshold(4, DEFAULT_RETURN_REMINDERS)).toBe(5);
    expect(reminderThreshold(2, DEFAULT_RETURN_REMINDERS)).toBe(3);
    expect(reminderThreshold(0, DEFAULT_RETURN_REMINDERS)).toBe(1);
    expect(reminderThreshold(6, DEFAULT_RETURN_REMINDERS)).toBeNull();
  });

  it('follows the tenant settings', () => {
    expect(reminderThreshold(7, { daysBefore: [7], overdue: true })).toBe(7);
    expect(reminderThreshold(1, { daysBefore: [7], overdue: true })).toBe(7);
    expect(reminderThreshold(4, { daysBefore: [2, 1], overdue: true })).toBeNull();
    expect(reminderThreshold(2, { daysBefore: [2, 1], overdue: true })).toBe(2);
    expect(reminderThreshold(0, { daysBefore: [], overdue: true })).toBeNull();
  });

  it('alerts overdue only when the tenant keeps it on', () => {
    expect(reminderThreshold(-1, DEFAULT_RETURN_REMINDERS)).toBe('overdue');
    expect(reminderThreshold(-3, { daysBefore: [], overdue: true })).toBe('overdue');
    expect(reminderThreshold(-1, { daysBefore: [5], overdue: false })).toBeNull();
  });
});

describe('ReturnReminderSettingsSchema', () => {
  it('accepts menu days, an empty list and the default', () => {
    expect(ReturnReminderSettingsSchema.safeParse(DEFAULT_RETURN_REMINDERS).success).toBe(true);
    expect(ReturnReminderSettingsSchema.safeParse({ daysBefore: [], overdue: false }).success).toBe(true);
    expect(ReturnReminderSettingsSchema.safeParse({ daysBefore: [7, 2], overdue: true }).success).toBe(true);
  });

  it('rejects off-menu days, repeats and unknown keys', () => {
    expect(ReturnReminderSettingsSchema.safeParse({ daysBefore: [4], overdue: true }).success).toBe(false);
    expect(ReturnReminderSettingsSchema.safeParse({ daysBefore: [0], overdue: true }).success).toBe(false);
    expect(ReturnReminderSettingsSchema.safeParse({ daysBefore: [5, 5], overdue: true }).success).toBe(false);
    expect(ReturnReminderSettingsSchema.safeParse({ daysBefore: [5], overdue: true, extra: 1 }).success).toBe(false);
  });
});

describe('labels and window', () => {
  it('reads naturally at each distance', () => {
    expect(returnDueLabel(3)).toBe('due in 3 days');
    expect(returnDueLabel(1)).toBe('due tomorrow');
    expect(returnDueLabel(0)).toBe('due today');
    expect(returnDueLabel(-1)).toBe('overdue by 1 day');
    expect(returnDueLabel(-4)).toBe('overdue by 4 days');
  });

  it('shows staff as far ahead as the widest point', () => {
    expect(returnWindowDays(DEFAULT_RETURN_REMINDERS)).toBe(5);
    expect(returnWindowDays({ daysBefore: [2, 7], overdue: true })).toBe(7);
    expect(returnWindowDays({ daysBefore: [], overdue: true })).toBe(0);
  });
});

describe('returnReminderEmail', () => {
  const origin = 'https://almara.arkilaunch.app';
  const payload: ReturnReminderPayload = {
    rental_id: 'r-1',
    code: 'EQR-2026-0001',
    threshold: 3,
    days_left: 3,
    machines: [{ assignment_id: 'a-1', equipment_id: 'e-1', label: 'CAT 320 (SN-1)', end: '2026-10-18T09:00:00Z' }],
  };

  it('tells the customer what to return and links their booking', () => {
    const mail = returnReminderEmail('return_reminder', payload, 'customer', origin);
    expect(mail?.subject).toBe('Return reminder: EQR-2026-0001 is due in 3 days');
    expect(mail?.text).toContain('- CAT 320 (SN-1): return by October 18, 2026');
    expect(mail?.text).toContain('View booking: https://almara.arkilaunch.app/account/bookings/r-1');
  });

  it('links staff to the booking in the console', () => {
    const mail = returnReminderEmail('return_overdue', { ...payload, threshold: 'overdue', days_left: -1 }, 'staff', origin);
    expect(mail?.subject).toBe('Overdue return: EQR-2026-0001');
    expect(mail?.text).toContain('Open EQR-2026-0001: https://almara.arkilaunch.app/app/bookings?open=EQR-2026-0001');
  });

  it('ignores other notification types', () => {
    expect(returnReminderEmail('payment_received', payload, 'customer', origin)).toBeNull();
  });
});
