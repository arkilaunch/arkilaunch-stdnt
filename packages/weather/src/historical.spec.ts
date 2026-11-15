import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHistoricalWeatherDay } from './historical.js';

afterEach(() => vi.unstubAllGlobals());

describe('historical weather evidence', () => {
  it('requests the work date in Manila time and validates a complete hourly day', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hourly_units: { wind_speed_10m: 'km/h', precipitation: 'mm' },
        hourly: {
          time: Array.from({ length: 24 }, (_, i) => `2026-10-01T${String(i).padStart(2, '0')}:00`),
          wind_speed_10m: Array(24).fill(10), precipitation: Array(24).fill(0), weather_code: Array(24).fill(1),
        },
      }),
    });
    vi.stubGlobal('fetch', fetch);
    const rows = await getHistoricalWeatherDay(14.6, 121, '2026-10-01');
    expect(rows).toHaveLength(24);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.hostname).toBe('archive-api.open-meteo.com');
    expect(url.searchParams.get('start_date')).toBe('2026-10-01');
    expect(url.searchParams.get('timezone')).toBe('Asia/Manila');
    expect(url.searchParams.get('models')).toBe('best_match');
  });

  it('rejects a partial day rather than presenting it as evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hourly_units: { wind_speed_10m: 'km/h', precipitation: 'mm' }, hourly: {
        time: ['2026-10-01T00:00'], wind_speed_10m: [10], precipitation: [0], weather_code: [1],
      } }),
    }));
    await expect(getHistoricalWeatherDay(14.6, 121, '2026-10-01')).rejects.toThrow('incomplete');
  });

  it('rejects hourly values from a different day', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hourly_units: { wind_speed_10m: 'km/h', precipitation: 'mm' }, hourly: {
        time: Array.from({ length: 24 }, (_, i) => `2026-09-30T${String(i).padStart(2, '0')}:00`),
        wind_speed_10m: Array(24).fill(10), precipitation: Array(24).fill(0), weather_code: Array(24).fill(1),
      } }),
    }));
    await expect(getHistoricalWeatherDay(14.6, 121, '2026-10-01')).rejects.toThrow('timestamps');
  });
});
