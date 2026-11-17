import { manilaDate } from '@arkilaunch/shared';

export function rentalExpiryCutoff(now: Date): Date {
  return new Date(`${manilaDate(now)}T00:00:00+08:00`);
}

export function rentalStartPassed(start: Date, now: Date): boolean {
  return start < rentalExpiryCutoff(now);
}

export function truckSchedulePassed(scheduledFor: Date, now: Date): boolean {
  return scheduledFor < now;
}
