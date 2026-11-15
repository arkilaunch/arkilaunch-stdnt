import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EdtrDetailResponse, IncidentResponse, WeatherCode } from '@arkilaunch/shared';
import { DEFAULT_AM_WINDOW, DEFAULT_PM_WINDOW } from '@arkilaunch/shared';
import { edtrQueries, incidentsQueries, usersQueries } from '../lib/queries.js';
import { apiPost } from '../lib/api-client.js';
import { Button } from './button.js';
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
  const evidence = useQuery(edtrQueries.weatherEvidence(detail.id));
  const me = useQuery(usersQueries.me());
  const queryClient = useQueryClient();
  const [fetching, setFetching] = useState(false);
  const [historyError, setHistoryError] = useState(false);
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
            const coverage = half === 'am' ? evidence.data?.am : evidence.data?.pm;
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
                    <span className="text-text-muted">
                      {evidence.isPending ? 'Checking saved readings...' : evidence.isError ? 'Weather evidence unavailable' : !code ? 'No weather reported on sheet' : coverage?.sufficient ? 'No mismatch found in saved readings' : 'Insufficient saved weather data'}
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {problems.map((incident) => (
                        <li key={incident.id} className="border-l-4 border-recon-review pl-2 text-text">
                          {incident.detail ?? 'Flagged for review.'}
                        </li>
                      ))}
                    </ul>
                  )}
                  {coverage && <span className="block text-xs text-text-muted">Saved readings: {coverage.recorded} of {coverage.expected} half-hour slots</span>}
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
      {evidence.data?.historical && (
        <p className="text-xs text-text-muted">
          Modelled historical weather, supporting evidence only: {evidence.data.historical.source} ({evidence.data.historical.model}),
          fetched {new Date(evidence.data.historical.fetchedAt).toLocaleString()}; {evidence.data.historical.readings.length} hourly readings,
          peak wind {Math.max(...evidence.data.historical.readings.map((r) => r.windKph))} km/h,
          total reported rain {evidence.data.historical.readings.reduce((sum, r) => sum + r.precipMm, 0).toFixed(1)} mm.
        </p>
      )}
      {evidence.data?.historicalAvailable && !evidence.data.historical && (me.data?.role === 'admin' || me.data?.role === 'platform_admin') && (
        <div>
          <Button disabled={fetching} onClick={() => {
            setFetching(true);
            setHistoryError(false);
            void apiPost(`/edtr/${detail.id}/weather-evidence/historical`, {})
              .then(() => queryClient.invalidateQueries({ queryKey: edtrQueries.weatherEvidence(detail.id).queryKey }))
              .catch(() => setHistoryError(true))
              .finally(() => setFetching(false));
          }}>{fetching ? 'Fetching...' : 'Fetch historical weather'}</Button>
          {historyError && <p role="alert" className="text-sm text-error">Historical weather is unavailable. Try again later.</p>}
        </div>
      )}
      <p className="text-xs text-text-muted">
        Flags are for review, not findings. Weather and other downtime hours are never billed unless you change them.
      </p>
    </Surface>
  );
}
