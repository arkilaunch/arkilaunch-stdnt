import type { WeatherObservation } from './weather-port.js';
import { DEFAULT_WEATHER_THRESHOLDS, evaluateSeverity, type WeatherSeverity, type WeatherThresholds } from './weather.js';

// Printed tick-box order: the OCR parser reads boxes by position, so this order is the form.
export const WEATHER_CODES = ['C', 'O', 'LR', 'HR', 'W', 'T'] as const;
export type WeatherCode = (typeof WEATHER_CODES)[number];

export const IDLE_REASONS = ['weather', 'breakdown', 'no_operator', 'client_hold', 'other'] as const;
export type IdleReason = (typeof IDLE_REASONS)[number];

export const DEFAULT_AM_WINDOW: [number, number] = [7 * 60, 12 * 60];
export const DEFAULT_PM_WINDOW: [number, number] = [13 * 60, 17 * 60];

export interface TimedReading {
  minute: number;
  observed: WeatherObservation;
}

export interface WeatherCoverage {
  expected: number;
  recorded: number;
  sufficient: boolean;
}

// A work interval needs almost every scheduled 30-minute reading before absence of weather is evidence.
export function weatherCoverage(readings: TimedReading[], window: [number, number]): WeatherCoverage {
  const expected = Math.ceil((window[1] - window[0]) / 30);
  const slots = new Set(
    readings
      .filter((r) => r.minute >= window[0] && r.minute < window[1])
      .map((r) => Math.floor((r.minute - window[0]) / 30)),
  );
  const recorded = slots.size;
  return { expected, recorded, sufficient: expected > 0 && recorded > 0 && expected - recorded <= 1 };
}

export interface HalfDaySystemView {
  readingCount: number;
  maxWindKph: number;
  totalPrecipMm: number;
  worstSeverity: WeatherSeverity;
}

export const SEVERITY_RANK: Record<WeatherSeverity, number> = { none: 0, watch: 1, warning: 2 };

export function summarizeReadings(
  readings: TimedReading[],
  window: [number, number],
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): HalfDaySystemView {
  const inside = readings.filter((r) => r.minute >= window[0] && r.minute < window[1]);
  let worstSeverity: WeatherSeverity = 'none';
  for (const r of inside) {
    const s = evaluateSeverity(r.observed, thresholds);
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worstSeverity]) worstSeverity = s;
  }
  return {
    readingCount: inside.length,
    maxWindKph: Math.max(0, ...inside.map((r) => r.observed.windKph)),
    totalPrecipMm: Math.round(inside.reduce((sum, r) => sum + r.observed.precipMm, 0) * 10) / 10,
    worstSeverity,
  };
}

export interface ReportedWeatherDay {
  weatherAm: WeatherCode | null;
  weatherPm: WeatherCode | null;
  idleHours: number | null;
  idleReason: IdleReason | null;
  hoursActive: number;
  weatherHours?: number | null;
  amWindow?: [number, number] | null;
  pmWindow?: [number, number] | null;
}

const asCode = (v: string | null | undefined): WeatherCode | null =>
  v && (WEATHER_CODES as readonly string[]).includes(v) ? (v as WeatherCode) : null;

// One reading of a day for the OCR worker and typed entries alike: v3 weather hours stand in for a weather idle reason.
export function reportedWeatherDay(input: {
  weatherAm?: string | null | undefined;
  weatherPm?: string | null | undefined;
  hoursActive: number;
  weatherHours?: number | null | undefined;
  idleHours?: number | null | undefined;
  idleReason?: IdleReason | null | undefined;
  amWindow?: [number, number] | null | undefined;
  pmWindow?: [number, number] | null | undefined;
}): ReportedWeatherDay {
  const weatherHours = input.weatherHours ?? null;
  const weatherIdle = (weatherHours ?? 0) > 0;
  return {
    weatherAm: asCode(input.weatherAm),
    weatherPm: asCode(input.weatherPm),
    idleHours: weatherIdle ? weatherHours : (input.idleHours ?? null),
    idleReason: weatherIdle ? 'weather' : (input.idleReason ?? null),
    hoursActive: input.hoursActive,
    weatherHours,
    amWindow: input.amWindow ?? null,
    pmWindow: input.pmWindow ?? null,
  };
}

// Ticks that mean work should have stopped. LR is printed as "light rain, work continued".
export const BAD_WEATHER_CODES: readonly WeatherCode[] = ['HR', 'W', 'T'];

// The sheet's own word against its own hours: running hours in a half the timekeeper ticked HR, W or T.
// Evidence for a person (RFC-2), never money.
export function workedInReportedWeather(day: ReportedWeatherDay): ('am' | 'pm' | 'day')[] {
  if (!(day.hoursActive > 0)) return [];
  const bad = (['am', 'pm'] as const).filter((half) =>
    BAD_WEATHER_CODES.includes((half === 'am' ? day.weatherAm : day.weatherPm) as WeatherCode),
  );
  if (bad.length === 0) return [];
  // A v2 sheet writes each half's time in/out: a filled window is proof the machine ran that half.
  if (day.amWindow || day.pmWindow) {
    return bad.filter((half) => (half === 'am' ? day.amWindow : day.pmWindow));
  }
  // ponytail: day-total heuristic without time windows; read per-half hours if false positives show up.
  if (bad.length === 2) return ['day'];
  return (day.weatherHours ?? 0) > 0 ? [] : bad;
}

export type WeatherDiscrepancyRule = 'D1' | 'D2';

export interface WeatherDiscrepancy {
  rule: WeatherDiscrepancyRule;
  half: 'am' | 'pm' | 'day';
  reported: WeatherCode | IdleReason | null;
  system: HalfDaySystemView;
}

// Both flags hold the day for a human (RFC-2) and never change money; no readings is never a flag.
export function compareReportedWeather(
  day: ReportedWeatherDay,
  readings: TimedReading[],
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): WeatherDiscrepancy[] {
  const am = summarizeReadings(readings, day.amWindow ?? DEFAULT_AM_WINDOW, thresholds);
  const pm = summarizeReadings(readings, day.pmWindow ?? DEFAULT_PM_WINDOW, thresholds);
  const amCoverage = weatherCoverage(readings, day.amWindow ?? DEFAULT_AM_WINDOW);
  const pmCoverage = weatherCoverage(readings, day.pmWindow ?? DEFAULT_PM_WINDOW);
  const flags: WeatherDiscrepancy[] = [];

  if (day.idleReason === 'weather' && (day.idleHours ?? 0) > 0 && amCoverage.sufficient && pmCoverage.sufficient) {
    const whole: HalfDaySystemView = {
      readingCount: am.readingCount + pm.readingCount,
      maxWindKph: Math.max(am.maxWindKph, pm.maxWindKph),
      totalPrecipMm: Math.round((am.totalPrecipMm + pm.totalPrecipMm) * 10) / 10,
      worstSeverity: SEVERITY_RANK[am.worstSeverity] >= SEVERITY_RANK[pm.worstSeverity] ? am.worstSeverity : pm.worstSeverity,
    };
    if (whole.worstSeverity === 'none' && whole.totalPrecipMm < thresholds.precipMmWatch) {
      flags.push({ rule: 'D1', half: 'day', reported: 'weather', system: whole });
    }
  }

  const workedFullDay = day.hoursActive > 0 && !(day.idleHours && day.idleHours > 0);
  if (workedFullDay) {
    for (const [half, view, reported] of [
      ['am', am, day.weatherAm],
      ['pm', pm, day.weatherPm],
    ] as const) {
      if ((half === 'am' ? amCoverage : pmCoverage).sufficient && view.worstSeverity === 'warning' && (reported === 'C' || reported === 'O')) {
        flags.push({ rule: 'D2', half, reported, system: view });
      }
    }
  }
  return flags;
}

// Exactly one ticked box of the expected count, above the gate; anything else is null, never guessed.
export function readTickGroup<T extends string>(
  content: string,
  options: readonly T[],
  confidence: number,
  gate: number,
): T | null {
  if (confidence < gate) return null;
  const marks = content.match(/:(un)?selected:/g) ?? [];
  if (marks.length !== options.length) return null;
  const ticked = marks.flatMap((m, i) => (m === ':selected:' ? [i] : []));
  return ticked.length === 1 ? options[ticked[0]!]! : null;
}
