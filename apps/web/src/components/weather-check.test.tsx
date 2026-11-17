import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EdtrDetailResponse, EdtrWeatherEvidence } from '@arkilaunch/shared';
import { edtrQueries, incidentsQueries } from '../lib/queries.js';
import { WeatherCheck } from './weather-check.js';

const id = '0f289fc5-158a-4d9f-9160-8e8e721a5520';
const detail = { id, weather: { am: 'C', pm: 'C', amWindow: null, pmWindow: null } } as EdtrDetailResponse;

function html(sufficient: boolean, sheet = detail) {
  const client = new QueryClient();
  client.setQueryData(incidentsQueries.forFieldLog(id).queryKey, { items: [], total: 0 });
  client.setQueryData(edtrQueries.weatherEvidence(id).queryKey, {
    reportDate: '2026-10-01',
    am: { window: [420, 720], usedDefaultHours: true, expected: 10, recorded: sufficient ? 10 : 1, sufficient },
    pm: { window: [780, 1020], usedDefaultHours: true, expected: 8, recorded: sufficient ? 8 : 0, sufficient },
    historicalAvailable: false, historical: null,
  } satisfies EdtrWeatherEvidence);
  return renderToStaticMarkup(<QueryClientProvider client={client}><WeatherCheck detail={sheet} /></QueryClientProvider>);
}

describe('field-log weather check', () => {
  it('shows insufficient coverage instead of an all-clear', () => {
    expect(html(false)).toContain('Insufficient saved weather data');
    expect(html(false)).not.toContain('No mismatch found');
  });

  it('only says no mismatch when readings and a sheet tick exist', () => {
    expect(html(true)).toContain('No mismatch found in saved readings');
    expect(html(true, { ...detail, weather: null })).toContain('No weather reported on sheet');
  });
});
