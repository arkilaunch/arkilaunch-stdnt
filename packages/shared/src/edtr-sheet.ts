import { DEFAULT_TOLERANCE_HOURS, TICK_CONFIDENCE_GATE } from './edtr.js';
import {
  IDLE_REASONS,
  WEATHER_CODES,
  readTickGroup,
  type IdleReason,
  type WeatherCode,
} from './weather-attestation.js';
import type { BoundingRegion, ExtractedTable } from './document-intelligence-port.js';

// Parses the Almara EDTR sheet: one sheet carries many dated rows, fanned out into one reading per day.
export interface EdtrSheetDay {
  reportDate: string;
  // The signed written figure; never replaced by computedHours (not what anyone recorded).
  hoursActive: number;
  computedHours: number | null;
  // The sheet contradicts itself, so the day must reach a human.
  totalMismatch: boolean;
  // Min confidence of the date and billed cell only (the values that become the record); feeds the 0.90 gate.
  confidence: number;
  boundingRegion?: BoundingRegion;
  v2?: {
    idleHours: number | null;
    idleReason: IdleReason | null;
    weatherAm: WeatherCode | null;
    weatherPm: WeatherCode | null;
    amWindow: [number, number] | null;
    pmWindow: [number, number] | null;
  };
  // v3: blank hour cell on a filled row is 0; unreadable is null.
  v3?: {
    total: number | null;
    running: number;
    idle: number | null;
    breakdown: number | null;
    weather: number | null;
    other: number | null;
    meterStart: number | null;
    meterEnd: number | null;
  };
  // v3: figures filled from the row's own arithmetic, or read two ways; a person confirms them.
  hoursFilled?: string[];
  // v3: every figure read, but they do not add up to TOTAL.
  rowMismatch?: boolean;
}

// The sheet's own WEEK SUMMARY, a cross-check for the office; never billed from (RFC-2).
export interface EdtrWeekSummary {
  billable: number | null;
  notBilled: number | null;
}

export type EdtrSheetParse =
  // `unreadable`: dated, filled days whose billed hours could not be read; each goes to a human.
  | { ok: true; days: EdtrSheetDay[]; unreadable: string[]; weekSummary: EdtrWeekSummary }
  | { ok: false; reason: string };

const DATE_HEADER = 'DATE';
const TOTAL_HEADER = 'TOTAL';
const GROUPS = ['AM', 'PM', 'OVERTIME'] as const;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

interface Grid {
  rows: string[][];
  confidences: number[][];
  regions: (BoundingRegion | undefined)[][];
  rowCount: number;
  columnCount: number;
}

function toGrid(table: ExtractedTable): Grid | null {
  const rows: string[][] = Array.from({ length: table.rowCount }, () =>
    Array<string>(table.columnCount).fill(''),
  );
  const confidences: number[][] = Array.from({ length: table.rowCount }, () =>
    Array<number>(table.columnCount).fill(0),
  );
  const regions: (BoundingRegion | undefined)[][] = Array.from({ length: table.rowCount }, () =>
    Array<BoundingRegion | undefined>(table.columnCount).fill(undefined),
  );
  for (const cell of table.cells) {
    // Out-of-bounds cell: not the grid Azure described, so refuse.
    if (cell.rowIndex >= table.rowCount || cell.columnIndex >= table.columnCount) return null;
    if (cell.rowIndex < 0 || cell.columnIndex < 0) return null;
    rows[cell.rowIndex]![cell.columnIndex] = cell.content;
    confidences[cell.rowIndex]![cell.columnIndex] = cell.confidence;
    regions[cell.rowIndex]![cell.columnIndex] = cell.boundingRegion;
  }
  return { rows, confidences, regions, rowCount: table.rowCount, columnCount: table.columnCount };
}

interface Columns {
  date: number;
  total: number;
  pairs: Array<[number, number]>;
  am: [number, number] | null;
  pm: [number, number] | null;
  idleHours: number;
  idleReason: number;
  weatherAm: number;
  weatherPm: number;
  day: number;
  running: number;
  breakdown: number;
  weatherHrs: number;
  other: number;
  meterStart: number;
  meterEnd: number;
  headerRows: number;
}

// Two header rows: group labels in row 0, IN/OUT sub-labels in row 1.
function findColumns(grid: Grid): Columns | null {
  const row0 = grid.rows[0];
  const row1 = grid.rows[1];
  if (!row0 || !row1) return null;

  const date = row0.findIndex((c) => norm(c).includes(DATE_HEADER));
  const total = row0.findIndex((c) => norm(c).includes(TOTAL_HEADER));
  if (date < 0 || total < 0) return null;

  const pairs: Array<[number, number]> = [];
  const named: Partial<Record<(typeof GROUPS)[number], [number, number]>> = {};
  for (const group of GROUPS) {
    const at = row0.findIndex((c) => norm(c) === group);
    if (at < 0) continue;
    const ins: number[] = [];
    const outs: number[] = [];
    // Bounded by the next different row-0 label so OVERTIME cannot read the TOTAL column as a time.
    for (let c = at; c < grid.columnCount; c++) {
      const label = norm(row0[c] ?? '');
      if (c > at && label !== '' && label !== group) break;
      const sub = norm(row1[c] ?? '');
      if (sub === 'IN') ins.push(c);
      if (sub === 'OUT') outs.push(c);
    }
    if (ins.length === 1 && outs.length === 1) {
      pairs.push([ins[0]!, outs[0]!]);
      named[group] = [ins[0]!, outs[0]!];
    }
  }

  const at = (label: string) => row0.findIndex((c) => norm(c) === label);
  return {
    date,
    total,
    pairs,
    am: named.AM ?? null,
    pm: named.PM ?? null,
    idleHours: at('IDLE HRS'),
    idleReason: at('IDLE REASON'),
    weatherAm: at('WEATHER AM'),
    weatherPm: at('WEATHER PM'),
    day: at('DAY'),
    running: at('RUNNING HRS'),
    breakdown: at('BREAKDOWN HRS'),
    weatherHrs: at('WEATHER HRS'),
    other: at('OTHER HRS'),
    meterStart: at('METER START'),
    meterEnd: at('METER END'),
    headerRows: 2,
  };
}

// The v3 sheet prints a comb box per digit; the reader returns their outlines as L, J, |, _ and the like.
// Only digits, the separator and the decimal point are handwriting. A decimal point can come back as a comma.
function handwriting(raw: string): string {
  return norm(raw).replace(/,/g, '.').replace(/[^0-9.:]/g, '');
}

// Times are 4 comb boxes around a printed colon; box edges can come back as extra dots or colons,
// so the time is read from its digits alone: 0730, 730 -> 07:30.
function parseTime(raw: string): number | null {
  const digits = handwriting(raw).replace(/[.:]/g, '');
  if (digits.length < 3 || digits.length > 4) return null;
  const h = Number(digits.slice(0, -2));
  const min = Number(digits.slice(-2));
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// A box edge at either end can read as a dot, and the printed dot plus the written one as two;
// one run inside is the decimal point. Two apart (1.2.5) is ambiguous: null.
function hoursText(raw: string): string | null {
  const t = handwriting(raw).replace(/:/g, '').replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
  return t === '' || (t.match(/\./g)?.length ?? 0) > 1 ? null : t;
}

function parseHours(raw: string): number | null {
  const t = hoursText(raw);
  // The comb prints its decimal point (_ _ . _), so DI drops it: "75" is 7.5. Only an impossible day (>24) is re-read.
  // ponytail: a dotless "15" (1.5) still reads 15; the IN/OUT reconciliation catches it and routes to a human.
  const n = t === null ? NaN : /^\d{2,3}$/.test(t) && Number(t) > 24 ? Number(t) / 10 : Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 24 ? n : null;
}

const isHalfStep = (n: number) => n >= 0 && n <= 24 && Number.isInteger(n * 2);

// v3 hours box: 2 whole-hour boxes, a printed dot, 1 decimal box, and the reader often drops the dot.
// Without one, the last digit sits in the decimal box: 75 -> 7.5, 105 -> 10.5. Only whole or half hours.
// `sure` is false when the digits also read as whole hours (10 is 1.0 or 10): a person decides.
// ponytail: positional read is tied to the v3 2+1 comb; revisit if the printed hours box changes.
function parseCombHours(raw: string): { n: number; sure: boolean } | null {
  const t = hoursText(raw);
  if (t === null) return null;
  if (t.includes('.') || t.length === 1) return isHalfStep(Number(t)) ? { n: Number(t), sure: true } : null;
  const n = Number(t) / 10;
  return isHalfStep(n) ? { n, sure: !isHalfStep(Number(t)) } : null;
}

// Pick the year nearest the capture date, or a December sheet shot in January misfiles by a year.
export function resolveSheetDate(raw: string, captureDate: string): string | null {
  const text = norm(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const md = /^(\d{1,2})[/\-.](\d{1,2})$/.exec(text);
  if (!md) return null;
  const month = Number(md[1]);
  const day = Number(md[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const capture = new Date(`${captureDate}T00:00:00Z`);
  if (Number.isNaN(capture.getTime())) return null;
  const captureYear = capture.getUTCFullYear();

  let best: { date: string; distance: number } | null = null;
  for (const year of [captureYear - 1, captureYear, captureYear + 1]) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) continue;
    const distance = Math.abs(candidate.getTime() - capture.getTime());
    if (!best || distance < best.distance) {
      best = { date: candidate.toISOString().slice(0, 10), distance };
    }
  }
  return best?.date ?? null;
}

function window(row: string[], pair: [number, number] | null): [number, number] | null {
  if (!pair) return null;
  const start = parseTime(row[pair[0]] ?? '');
  const end = parseTime(row[pair[1]] ?? '');
  return start !== null && end !== null && end > start ? [start, end] : null;
}

function readV2(row: string[], confidences: number[], columns: Columns): EdtrSheetDay['v2'] {
  if (columns.weatherAm < 0 && columns.weatherPm < 0 && columns.idleReason < 0) return undefined;
  const tick = <T extends string>(col: number, options: readonly T[]) =>
    col < 0 ? null : readTickGroup(row[col] ?? '', options, confidences[col] ?? 0, TICK_CONFIDENCE_GATE);
  return {
    idleHours: columns.idleHours < 0 ? null : parseHours(row[columns.idleHours] ?? ''),
    idleReason: tick(columns.idleReason, IDLE_REASONS),
    weatherAm: tick(columns.weatherAm, WEATHER_CODES),
    weatherPm: tick(columns.weatherPm, WEATHER_CODES),
    amWindow: window(row, columns.am),
    pmWindow: window(row, columns.pm),
  };
}

function parseMeter(raw: string): number | null {
  const t = norm(raw);
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function v3FillColumns(columns: Columns): number[] {
  return [
    ...columns.pairs.flat(),
    columns.total,
    columns.running,
    columns.idleHours,
    columns.breakdown,
    columns.weatherHrs,
    columns.other,
    columns.meterStart,
    columns.meterEnd,
  ].filter((c) => c >= 0);
}

function computeHours(row: string[], pairs: Array<[number, number]>): number | null {
  let minutes = 0;
  let sawPair = false;
  for (const [inCol, outCol] of pairs) {
    const start = parseTime(row[inCol] ?? '');
    const end = parseTime(row[outCol] ?? '');
    // Half-filled pair is unknown, not zero: the computed figure becomes unavailable.
    if (start === null && end === null) continue;
    if (start === null || end === null) return null;
    if (end < start) return null;
    minutes += end - start;
    sawPair = true;
  }
  return sawPair ? minutes / 60 : null;
}

// The sheet also yields small header tables; a DATE+TOTAL table wins, row count breaks ties.
function findTimesheet(tables: ExtractedTable[]): { grid: Grid; columns: Columns } | null {
  let best: { grid: Grid; columns: Columns } | null = null;
  for (const table of tables) {
    const grid = toGrid(table);
    if (!grid) continue;
    const columns = findColumns(grid);
    if (!columns) continue;
    if (!best || grid.rowCount > best.grid.rowCount) best = { grid, columns };
  }
  return best;
}

export function parseEdtrSheet(
  tables: ExtractedTable[] | undefined,
  captureDate: string,
  tolerance: number = DEFAULT_TOLERANCE_HOURS,
): EdtrSheetParse {
  const found = findTimesheet(tables ?? []);
  if (!found) return { ok: false, reason: 'no_timesheet_table' };
  const { grid, columns } = found;

  const days: EdtrSheetDay[] = [];
  const unreadableDates: string[] = [];
  const unreadableTotals: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (let r = columns.headerRows; r < grid.rowCount; r++) {
    const row = grid.rows[r]!;
    const rawDate = row[columns.date] ?? '';
    if (norm(rawDate) === '') continue;

    const isV3 = columns.running >= 0;
    // v3 pre-prints dates; OUTSIDE or unfilled days are skipped (they show as Missing in the site hub).
    if (isV3) {
      const dayCell = columns.day >= 0 ? norm(row[columns.day] ?? '') : '';
      if (dayCell.includes('OUTSIDE')) continue;
      // Written means a digit somewhere: empty comb boxes alone are a blank day, not an unreadable one.
      if (v3FillColumns(columns).every((c) => !/\d/.test(row[c] ?? ''))) continue;
    }

    const reportDate = resolveSheetDate(rawDate, captureDate);
    if (!reportDate) {
      unreadableDates.push(rawDate);
      continue;
    }

    // v3 bills RUNNING HRS; v2 and the original form bill the written TOTAL.
    const billedColumn = isV3 ? columns.running : columns.total;
    const computedHours = computeHours(row, columns.pairs);
    const cell = (c: number) => (c >= 0 ? (row[c] ?? '') : '');
    const v3 = isV3 ? readV3Hours(cell, columns, computedHours) : null;
    const hoursActive = v3 ? v3.parts.get('running') ?? null : parseHours(cell(billedColumn));
    if (hoursActive == null) {
      // An unreadable day never stops the readable ones; it is handed to a human to transcribe.
      unreadableTotals.push(reportDate);
      continue;
    }

    if (seen.has(reportDate)) duplicates.push(reportDate);
    seen.add(reportDate);

    const cellConfidences = grid.confidences[r]!;
    const v2 = readV2(row, cellConfidences, columns);
    // v3: the IN/OUT times are time on duty, which is TOTAL, not RUNNING.
    const onDuty = v3 ? v3.total : hoursActive;
    const part = (name: string) => v3?.parts.get(name) ?? null;
    days.push({
      reportDate,
      hoursActive,
      computedHours,
      totalMismatch: computedHours !== null && onDuty !== null && Math.abs(computedHours - onDuty) > tolerance,
      confidence: Math.min(cellConfidences[columns.date] ?? 0, cellConfidences[billedColumn] ?? 0),
      ...(grid.regions[r]![billedColumn] ? { boundingRegion: grid.regions[r]![billedColumn]! } : {}),
      ...(v2 ? { v2 } : {}),
      ...(v3
        ? {
            v3: {
              total: v3.total,
              running: hoursActive,
              idle: part('idle'),
              breakdown: part('breakdown'),
              weather: part('weather'),
              other: part('other'),
              meterStart: parseMeter(cell(columns.meterStart)),
              meterEnd: parseMeter(cell(columns.meterEnd)),
            },
          }
        : {}),
      ...(v3?.filled.length ? { hoursFilled: v3.filled } : {}),
      ...(v3?.rowMismatch ? { rowMismatch: true } : {}),
    });
  }

  if (unreadableDates.length > 0) {
    return { ok: false, reason: `unreadable_date:${unreadableDates.join(',')}` };
  }
  if (duplicates.length > 0) {
    return { ok: false, reason: `duplicate_date:${[...new Set(duplicates)].join(',')}` };
  }
  if (days.length === 0) {
    return unreadableTotals.length > 0
      ? { ok: false, reason: `unreadable_total_hours:${unreadableTotals.join(',')}` }
      : { ok: false, reason: 'no_dated_rows' };
  }

  return { ok: true, days, unreadable: unreadableTotals, weekSummary: readWeekSummary(tables ?? []) };
}

// The summary is a separate small table: label in one cell, the written figure in the last filled one.
export function readWeekSummary(tables: ExtractedTable[]): EdtrWeekSummary {
  const summary: EdtrWeekSummary = { billable: null, notBilled: null };
  for (const table of tables) {
    const grid = toGrid(table);
    if (!grid) continue;
    for (const row of grid.rows) {
      const label = norm(row[0] ?? '');
      const written = row.slice(1).filter((c) => /\d/.test(c)).at(-1) ?? '';
      if (label.includes('BILLABLE HOURS')) summary.billable ??= parseWeekHours(written);
      else if (label.includes('NOT BILLED')) summary.notBilled ??= parseWeekHours(written);
    }
  }
  return summary;
}

// A week can pass 24 hours, so not parseHours.
function parseWeekHours(raw: string): number | null {
  const t = hoursText(raw);
  const n = t === null ? NaN : Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 24 * 7 ? n : null;
}

// v3 rows add up: TOTAL = RUNNING + IDLE + BREAKDOWN + WEATHER + OTHER. One figure the reader lost is
// filled from the rest (TOTAL from the IN/OUT times if it is lost too); a filled or unsure figure is
// listed in `filled` so a person confirms it before it bills (RFC-2).
function readV3Hours(cell: (c: number) => string, columns: Columns, computedHours: number | null) {
  const filled: string[] = [];
  // No digit in the boxes is blank: 0 for a downtime cause, unread for RUNNING and TOTAL.
  const read = (name: string, c: number, blank: number | null): number | null => {
    if (!/\d/.test(cell(c))) return blank;
    const hours = parseCombHours(cell(c));
    if (hours && !hours.sure) filled.push(name);
    return hours?.n ?? null;
  };
  const parts = new Map<string, number | null>();
  for (const [name, c] of [
    ['running', columns.running],
    ['idle', columns.idleHours],
    ['breakdown', columns.breakdown],
    ['weather', columns.weatherHrs],
    ['other', columns.other],
  ] as const) {
    if (c >= 0) parts.set(name, read(name, c, name === 'running' ? null : 0));
  }
  let total = read('total', columns.total, null);

  const lost = [...parts].filter(([, v]) => v === null).map(([name]) => name);
  const known = () => [...parts.values()].reduce<number>((sum, v) => sum + (v ?? 0), 0);
  if (total === null && lost.length === 1 && lost[0] === 'running' && computedHours !== null && isHalfStep(computedHours)) {
    total = computedHours;
    filled.push('total');
  }
  if (lost.length === 1 && total !== null && isHalfStep(total - known())) {
    parts.set(lost[0]!, total - known());
    filled.push(lost[0]!);
  }
  const rowMismatch =
    total !== null && [...parts.values()].every((v) => v !== null) && Math.abs(known() - total) > 0.01;
  return { parts, total, filled, rowMismatch };
}
