import { useQuery } from '@tanstack/react-query';
import { daysUntilReturn, returnDueLabel, returnWindowDays } from '@arkilaunch/shared';
import { bookingsQueries } from '../lib/queries.js';
import { StatusBadge } from './status-badge.js';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A live machine's return countdown, shown once it is inside the tenant's widest reminder point or overdue.
export function ReturnCountdown({ end }: { end: Date | string | null | undefined }) {
  const settings = useQuery(bookingsQueries.returnReminders());
  if (!end || !settings.data) return null;
  const days = daysUntilReturn(end);
  if (days > returnWindowDays(settings.data)) return null;
  return <StatusBadge status={days < 0 ? 'overdue' : 'pending'} label={capitalize(returnDueLabel(days))} />;
}
