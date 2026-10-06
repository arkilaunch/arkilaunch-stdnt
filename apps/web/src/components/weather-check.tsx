import { useQuery } from '@tanstack/react-query';
import type { EdtrDetailResponse, IncidentResponse, WeatherCode } from '@arkilaunch/shared';
import { DEFAULT_AM_WINDOW, DEFAULT_PM_WINDOW } from '@arkilaunch/shared';
import { incidentsQueries } from '../lib/queries.js';
import { Surface } from './surface.js';

// The printed sheet's own legend (lib/edtr-sheet.ts), so the reviewer reads the words the timekeeper ticked.
const WEATHER_WORDS: Record<WeatherCode, string> = {
  C: 'Clear',
  O: 'Cloudy',
  LR: 'Light rain, work continued',
  HR: 'Heavy rain',
  W: 'Strong wind',
  T: 'Storm / typhoon signal',
};

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function windowLabel(window: [number, number] | null | undefined, fallback: [number, number]): string {
  const [start, end] = window ?? fallback;
  return `${clock(start)}-${clock(end)}${window ? '' : ' (default hours)'}`;
}

function appliesTo(incident: IncidentResponse, half: 'am' | 'pm'): boolean {
  return incident.half === half || incident.half === 'day';
}

// The sheet's AM/PM weather against what the site's weather feed and the stop-work warnings recorded.
export function WeatherCheck({ detail }: { detail: EdtrDetailResponse }) {
  const incidents = useQuery(incidentsQueries.forFieldLog(detail.id));
  const weather = detail.weather;
  const flags = incidents.data?.items ?? [];
  // D1 is a whole-day finding: weather idle claimed on a day the feed saw none.
  const dayFlags = flags.filter((incident) => incident.half === 'day' && incident.kind === 'discrepancy');

  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-3">
      <p className="text-sm font-semibold text-text">Weather on the sheet vs. the site record</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted">
            <th scope="col" className="py-1 pr-2 font-normal">Half</th>
            <th scope="col" className="py-1 pr-2 font-normal">Timekeeper ticked</th>
            <th scope="col" className="py-1 font-normal">Check</th>
          </tr>
        </thead>
        <tbody>
          {(['am', 'pm'] as const).map((half) => {
            const code = half === 'am' ? weather?.am : weather?.pm;
            const window = half === 'am' ? weather?.amWindow : weather?.pmWindow;
            const found = flags.filter((incident) => incident.half !== 'day' && appliesTo(incident, half));
            const usedDespite = flags.filter((incident) => incident.kind === 'used_despite_warning' && appliesTo(incident, half));
            const problems = [...new Set([...found, ...usedDespite])];
            return (
              <tr key={half} className="align-top">
                <th scope="row" className="py-1 pr-2 text-left font-medium text-text">
                  {half.toUpperCase()}
                  <span className="block text-xs font-normal text-text-muted">
                    {windowLabel(window, half === 'am' ? DEFAULT_AM_WINDOW : DEFAULT_PM_WINDOW)}
                  </span>
                </th>
                <td className="py-1 pr-2 text-text">
                  {code ? `${code} - ${WEATHER_WORDS[code]}` : weather ? 'Unreadable or blank' : 'Not recorded'}
                </td>
                <td className="py-1">
                  {incidents.isPending ? (
                    <span className="text-text-muted">Checking...</span>
                  ) : incidents.isError ? (
                    <span className="text-text-muted">Could not load the weather check.</span>
                  ) : problems.length === 0 ? (
                    <span className="text-text-muted">No mismatch found</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {problems.map((incident) => (
                        <li key={incident.id} className="border-l-4 border-recon-review pl-2 text-text">
                          {incident.detail ?? 'Flagged for review.'}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {dayFlags.map((incident) => (
        <p key={incident.id} className="border-l-4 border-recon-review pl-2 text-sm text-text">
          Whole day: {incident.detail}
        </p>
      ))}
      <p className="text-xs text-text-muted">
        Flags are for review, not findings. Weather and other downtime hours are never billed unless you change them.
      </p>
    </Surface>
  );
}
