import { z } from 'zod';
import { WeatherObservationError } from './open-meteo-adapter.js';

const HourlySchema = z.object({
  hourly_units: z.object({ wind_speed_10m: z.literal('km/h'), precipitation: z.literal('mm') }),
  hourly: z.object({
    time: z.array(z.string()),
    wind_speed_10m: z.array(z.number()),
    precipitation: z.array(z.number()),
    weather_code: z.array(z.number()),
  }),
});

// Historical reanalysis is supplemental evidence, never a substitute for a saved live reading.
export async function getHistoricalWeatherDay(latitude: number, longitude: number, date: string) {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  for (const [key, value] of Object.entries({
    latitude: String(latitude), longitude: String(longitude), start_date: date, end_date: date,
    hourly: 'wind_speed_10m,precipitation,weather_code', wind_speed_unit: 'kmh',
    precipitation_unit: 'mm', timezone: 'Asia/Manila', models: 'best_match',
  })) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new WeatherObservationError('http_error', 'historical weather is unavailable');
  }
  if (!response.ok) throw new WeatherObservationError(response.status === 429 ? 'rate_limited' : 'http_error', 'historical weather is unavailable', response.status);
  const parsed = HourlySchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new WeatherObservationError('malformed_response', 'historical weather response failed validation');
  const { hourly } = parsed.data;
  if (hourly.time.length !== 24 || [hourly.wind_speed_10m, hourly.precipitation, hourly.weather_code].some((column) => column.length !== 24)) {
    throw new WeatherObservationError('malformed_response', 'historical weather day is incomplete');
  }
  if (hourly.time.some((time, hour) => time !== `${date}T${String(hour).padStart(2, '0')}:00`)) {
    throw new WeatherObservationError('malformed_response', 'historical weather timestamps do not match the requested Manila day');
  }
  return hourly.time.map((time, i) => ({
    time, windKph: hourly.wind_speed_10m[i]!, precipMm: hourly.precipitation[i]!, code: hourly.weather_code[i]!,
  }));
}
