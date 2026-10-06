import { describe, expect, it } from 'vitest';
import { parseEdtrSheet, readWeekSummary, resolveSheetDate } from './edtr-sheet.js';
import type { ExtractedTable } from './document-intelligence-port.js';

// The header shape prebuilt-layout returned for the real Almara sheet: row 0 groups, row 1 IN/OUT, data from row 2.
const HEADER = [
  ['DATE', 'AM', '', 'PM', '', 'OVERTIME', '', 'TOTAL HOURS', 'SIGNATURE'],
  ['', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', '', ''],
];

function table(dataRows: string[][]): ExtractedTable {
  const rows = [...HEADER, ...dataRows];
  return {
    rowCount: rows.length,
    columnCount: 9,
    cells: rows.flatMap((row, rowIndex) =>
      row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.99 })),
    ),
  };
}

const CAPTURE = '2026-03-06';

describe('parseEdtrSheet', () => {
  it('reads every dated row off one sheet, not just the first', () => {
    const result = parseEdtrSheet(
      [
        table([
          ['03/01', '07:00', '11:30', '13:00', '17:00', '18:00', '20:00', '10.5', ''],
          ['03/02', '07:00', '12:00', '13:00', '17:00', '', '', '9.0', ''],
          ['03/03', '08:00', '11:00', '13:30', '16:30', '', '', '6.0', ''],
          // The rest of the form is blank, which is the normal case.
          ['', '', '', '', '', '', '', '', ''],
          ['', '', '', '', '', '', '', '', ''],
        ]),
      ],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toHaveLength(3);
    expect(result.days.map((d) => d.reportDate)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    // The written total is the reading, never the computed one.
    expect(result.days.map((d) => d.hoursActive)).toEqual([10.5, 9, 6]);
    expect(result.days.every((d) => !d.totalMismatch)).toBe(true);
  });

  it('flags a row whose in/out times contradict the written total', () => {
    // 8.5 worked hours against a written 10.5: the page disagrees with itself, so a human must see it.
    const result = parseEdtrSheet(
      [table([['03/01', '07:00', '11:30', '13:00', '17:00', '', '', '10.5', '']])],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0]!.computedHours).toBe(8.5);
    expect(result.days[0]!.hoursActive).toBe(10.5);
    expect(result.days[0]!.totalMismatch).toBe(true);
  });

  it('reads a comb total whose printed decimal point DI dropped ("75" is 7.5)', () => {
    const result = parseEdtrSheet(
      [
        table([
          ['03/01', '07:00', '11:30', '13:00', '16:00', '', '', '75', ''],
          ['03/02', '07:00', '12:00', '13:00', '18:30', '', '', '105', ''],
        ]),
      ],
      CAPTURE,
    );

    expect(result.ok && result.days.map((d) => d.hoursActive)).toEqual([7.5, 10.5]);
  });

  it('names a dated row with an unreadable total for a human, and still reads the other days', () => {
    // Load-bearing: the unreadable day is never silently dropped, and never holds the sheet back.
    const result = parseEdtrSheet(
      [
        table([
          ['03/01', '07:00', '11:30', '13:00', '17:00', '', '', '10.5', ''],
          ['03/02', '07:00', '12:00', '13:00', '17:00', '', '', '', ''],
        ]),
      ],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.map((d) => d.reportDate)).toEqual(['2026-03-01']);
    expect(result.unreadable).toEqual(['2026-03-02']);
  });

  it('refuses the sheet when no dated row can be read', () => {
    const result = parseEdtrSheet([table([['03/02', '07:00', '12:00', '13:00', '17:00', '', '', '', '']])], CAPTURE);
    expect(result).toEqual({ ok: false, reason: 'unreadable_total_hours:2026-03-02' });
  });

  it('refuses a sheet listing the same date twice', () => {
    const result = parseEdtrSheet(
      [
        table([
          ['03/01', '07:00', '11:30', '13:00', '17:00', '', '', '10.5', ''],
          ['03/01', '07:00', '12:00', '13:00', '17:00', '', '', '9.0', ''],
        ]),
      ],
      CAPTURE,
    );

    expect(result).toEqual({ ok: false, reason: 'duplicate_date:2026-03-01' });
  });

  it('leaves computedHours null rather than short when a time pair is half filled', () => {
    // An IN with no OUT is unknown, not zero worked time.
    const result = parseEdtrSheet(
      [table([['03/01', '07:00', '', '13:00', '17:00', '', '', '8.0', '']])],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0]!.computedHours).toBeNull();
    expect(result.days[0]!.totalMismatch).toBe(false);
  });

  it('picks the timesheet out of the header tables on the same page', () => {
    // The CHARGE TO / EQPT. TYPE block is its own 2x2 table and must not be mistaken for the grid.
    const headerBlock: ExtractedTable = {
      rowCount: 2,
      columnCount: 2,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: 'CHARGE TO', confidence: 0.99 },
        { rowIndex: 0, columnIndex: 1, content: 'Tower 3 Podium Works', confidence: 0.99 },
        { rowIndex: 1, columnIndex: 0, content: 'EQPT. TYPE', confidence: 0.99 },
        { rowIndex: 1, columnIndex: 1, content: 'Crawler Crane CC-07', confidence: 0.99 },
      ],
    };
    const result = parseEdtrSheet(
      [headerBlock, table([['03/01', '07:00', '11:30', '13:00', '17:00', '', '', '8.5', '']])],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toHaveLength(1);
  });

  it('reads the merged-header shape the real form actually produces', () => {
    // The span-expanded real grid; the blank-padded HEADER above is the other variant, and both must parse.
    const merged = [
      ['DATE', 'AM', 'AM', 'PM', 'PM', 'OVERTIME', 'OVERTIME', 'TOTAL HOURS', 'SIGNATURE'],
      ['DATE', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', 'TOTAL HOURS', 'SIGNATURE'],
      ['03/01', '07:00', '11:30', '13:00', '17:00', '18:00', '20:00', '10.5', ''],
    ];
    const result = parseEdtrSheet(
      [
        {
          rowCount: merged.length,
          columnCount: 9,
          cells: merged.flatMap((row, rowIndex) =>
            row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.99 })),
          ),
        },
      ],
      CAPTURE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toEqual([
      {
        reportDate: '2026-03-01',
        hoursActive: 10.5,
        computedHours: 10.5,
        totalMismatch: false,
        confidence: 0.99,
      },
    ]);
  });

  it('refuses a page with no timesheet grid at all', () => {
    expect(parseEdtrSheet([], CAPTURE)).toEqual({ ok: false, reason: 'no_timesheet_table' });
    expect(parseEdtrSheet(undefined, CAPTURE)).toEqual({ ok: false, reason: 'no_timesheet_table' });
  });

  it('does not let OVERTIME reach into the TOTAL HOURS column', () => {
    // Guards the column-bounding logic: if the OVERTIME group scanned past
    // its own block it would read 10.5 as an out-time and compute nonsense.
    const result = parseEdtrSheet(
      [table([['03/01', '07:00', '11:30', '13:00', '17:00', '18:00', '20:00', '10.5', '']])],
      CAPTURE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days[0]!.computedHours).toBe(10.5);
  });
});

describe('resolveSheetDate', () => {
  it('resolves a bare MM/DD to the year nearest the capture', () => {
    expect(resolveSheetDate('03/01', '2026-03-06')).toBe('2026-03-01');
  });

  it('rolls a December row back a year when captured in January', () => {
    // A December sheet photographed on 2 January must not be filed eleven months ahead.
    expect(resolveSheetDate('12/28', '2027-01-02')).toBe('2026-12-28');
  });

  it('takes a full ISO date as written', () => {
    expect(resolveSheetDate('2026-03-01', '2026-03-06')).toBe('2026-03-01');
  });

  it('rejects a date that does not exist', () => {
    expect(resolveSheetDate('02/30', '2026-03-06')).toBeNull();
    expect(resolveSheetDate('13/01', '2026-03-06')).toBeNull();
    expect(resolveSheetDate('', '2026-03-06')).toBeNull();
  });
});

// EDTR v3 printed header: one hour column per cause plus the hour meter.
const V3_HEADER = [
  ['DATE', 'DAY', 'AM', '', 'PM', '', 'OVERTIME', '', 'TOTAL HOURS', 'RUNNING HRS', 'IDLE HRS', 'BREAKDOWN HRS', 'WEATHER HRS', 'OTHER HRS', 'METER START', 'METER END', 'INITIAL'],
  ['', '', 'IN', 'OUT', 'IN', 'OUT', 'IN', 'OUT', '', '', '', '', '', '', '', '', ''],
];

function v3Table(dataRows: string[][]): ExtractedTable {
  const rows = [...V3_HEADER, ...dataRows];
  return {
    rowCount: rows.length,
    columnCount: V3_HEADER[0]!.length,
    cells: rows.flatMap((row, rowIndex) =>
      row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.99 })),
    ),
  };
}

describe('parseEdtrSheet v3', () => {
  it('bills RUNNING HRS, keeps each downtime cause, and checks IN/OUT against TOTAL', () => {
    const result = parseEdtrSheet(
      [
        v3Table([
          ['03/02', 'MON', '07:00', '12:00', '13:00', '17:00', '', '', '9', '6', '1', '2', '', '', '1200.5', '1206.5', 'JR'],
        ]),
      ],
      CAPTURE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [day] = result.days;
    expect(day!.hoursActive).toBe(6);
    expect(day!.totalMismatch).toBe(false);
    expect(day!.v3).toEqual({
      total: 9,
      running: 6,
      idle: 1,
      breakdown: 2,
      weather: 0,
      other: 0,
      meterStart: 1200.5,
      meterEnd: 1206.5,
    });
  });

  it('skips a day marked outside the rental and a day left blank, instead of failing the sheet', () => {
    const blank = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
    const result = parseEdtrSheet(
      [
        v3Table([
          ['03/01', 'OUTSIDE RENTAL', ...blank],
          ['03/02', 'MON', '07:00', '11:00', '', '', '', '', '4', '4', '', '', '', '', '', '', ''],
          ['03/03', 'TUE', ...blank],
        ]),
      ],
      CAPTURE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.map((d) => d.reportDate)).toEqual(['2026-03-02']);
  });

  it('skips a blank day whose empty comb boxes came back as stray strokes, and reads digits inside the boxes', () => {
    const boxes = ['L_J', '|_|', 'LJ', '', '', '', '', '', '', '', '', '', '', '', ''];
    const result = parseEdtrSheet(
      [
        v3Table([
          ['03/02', 'MON', 'L07:30J', '|12:00|', '', '', '', '', '4.5', 'L4.5J', '', '', '', '', '', '', ''],
          ['03/08', 'SUN', ...boxes],
        ]),
      ],
      CAPTURE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days.map((d) => [d.reportDate, d.hoursActive])).toEqual([['2026-03-02', 4.5]]);
  });

  it('reads times and hours through comb-box edges returned as dots and colons, and refuses an ambiguous figure', () => {
    const read = (running: string) =>
      parseEdtrSheet(
        [v3Table([['03/02', 'MON', '.0.7:3.0', '1.2::0.0.', '', '', '', '', '4.5', running, '', '', '', '', '', '', '']])],
        CAPTURE,
      );
    const clean = read('.4.5.');
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(clean.days[0]!.hoursActive).toBe(4.5);
    expect(clean.days[0]!.computedHours).toBe(4.5);
    // The printed dot plus the written one reads as two; dots apart are no reading, so TOTAL fills it for a person.
    const doubled = read('4..5');
    expect(doubled.ok && doubled.days[0]!.hoursActive).toBe(4.5);
    const ambiguous = read('1.2.5');
    expect(ambiguous.ok && ambiguous.days[0]!.hoursFilled).toEqual(['running']);
  });

  // Hours box: 2 whole-hour boxes, a printed dot, 1 decimal box. Azure drops the dot (live read, 2026-10-06).
  const hours = (running: string, total = '') =>
    parseEdtrSheet(
      [v3Table([['03/02', 'MON', '', '', '', '', '', '', total, running, '', '', '', '', '', '', '']])],
      CAPTURE,
    );
  const ran = (running: string, total = '') => {
    const r = hours(running, total);
    return r.ok ? [r.days[0]!.hoursActive, r.days[0]!.hoursFilled ?? []] : null;
  };

  it('reads a dropped decimal by box position, whole or half hours only', () => {
    expect(ran('75')).toEqual([7.5, []]);
    expect(ran('105')).toEqual([10.5, []]);
    expect(ran('100')).toEqual([10, []]);
    expect(ran('8')).toEqual([8, []]);
    expect(ran('7,5')).toEqual([7.5, []]);
    expect(ran('1.0,')).toEqual([1, []]);
    // 10 is 1.0 by position but also 10 whole hours: read by position, held for a person.
    expect(ran('10')).toEqual([1, ['running']]);
    // Not a half-hour, or over a day: a misread, never a figure.
    expect(ran('19')).toBeNull();
    expect(ran('25.0')).toBeNull();
  });

  it('fills the one figure the reader lost from the row total, and holds it for a person', () => {
    expect(ran('ZE', '75')).toEqual([7.5, ['running']]);
    // With TOTAL lost too, the IN/OUT times stand in for it.
    const result = parseEdtrSheet(
      [v3Table([['03/02', 'MON', '07:00', '11:00', '', '', '', '', '', '?!', '', '', '', '', '', '', '']])],
      CAPTURE,
    );
    expect(result.ok && [result.days[0]!.hoursActive, result.days[0]!.hoursFilled]).toEqual([4, ['total', 'running']]);
  });

  it('flags a row whose figures all read but do not add up to TOTAL', () => {
    const result = hours('6.0', '9.0');
    expect(result.ok && result.days[0]!.rowMismatch).toBe(true);
    const adds = hours('9.0', '9.0');
    expect(adds.ok && adds.days[0]!.rowMismatch).toBeUndefined();
  });

  it('reads the real 10/07-10/10 sheet as Azure returned it', () => {
    const blank = ['', '', '', ''];
    const result = parseEdtrSheet(
      [
        v3Table([
          ['10/07', 'WED', '07:30', '12:00', '13:39', '16:30', '16:30', '17 :30', '85', '75', '1.9', '', ...blank, 'b.D'],
          ['10/08', 'THU', '07:30', '13:99', '13:04', '16:00', '', '', '7.5', '75', '', '', ...blank, 'D.D'],
          ['10/09', 'FRI', '07:30', '42:,92', '13:00', '16:00', '16:00', '19:00', '105', '95', '', '1.0,', ...blank, 'D.D'],
          ['10/10', 'SAT', '07:30', '12:,92', '13.00', '16:00', '', '', '75', 'ZE', '', '', ...blank, 'D.D'],
        ]),
      ],
      '2026-10-06',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unreadable).toEqual([]);
    expect(result.days.map((d) => [d.reportDate, d.v3!.running, d.v3!.idle, d.v3!.breakdown, d.hoursFilled ?? []])).toEqual([
      ['2026-10-07', 7.5, 1, 0, ['idle']],
      ['2026-10-08', 7.5, 0, 0, []],
      ['2026-10-09', 9.5, 0, 1, []],
      ['2026-10-10', 7.5, 0, 0, ['running']],
    ]);
    expect(result.days.some((d) => d.rowMismatch)).toBe(false);
  });

  it('reads the WEEK SUMMARY table the sheet carries below the grid', () => {
    // As Azure returned it for EQR-2026-0013 (2026-10-06).
    const rows = [
      ['WEEK SUMMARY (cross-check; the system recomputes)', ''],
      ['Running + Idle = BILLABLE HOURS', '33'],
      ['Breakdown + Weather + Other = NOT BILLED', '1'],
      ['Hour meter end - start = METER HOURS', ''],
    ];
    const summary: ExtractedTable = {
      rowCount: 4,
      columnCount: 2,
      cells: rows.flatMap((row, rowIndex) => row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: 0.9 }))),
    };
    expect(readWeekSummary([summary])).toEqual({ billable: 33, notBilled: 1 });
    expect(readWeekSummary([])).toEqual({ billable: null, notBilled: null });
  });

  it('reads weather ticks at the confidence Azure gives scanned checkboxes, and not below the tick gate', () => {
    const header = [
      ['DATE', 'DAY', 'TOTAL HOURS', 'RUNNING HRS', 'WEATHER AM', 'WEATHER PM'],
      ['', '', '', '', 'C O LR HR W T', 'C O LR HR W T'],
    ];
    const ticks = ':selected: :unselected: :unselected: :unselected: :unselected: :unselected:';
    const read = (tickConfidence: number) => {
      const rows = [...header, ['10/07', 'WED', '8.5', '7.5', ticks, ticks]];
      const result = parseEdtrSheet(
        [
          {
            rowCount: rows.length,
            columnCount: 6,
            cells: rows.flatMap((row, rowIndex) =>
              row.map((content, columnIndex) => ({ rowIndex, columnIndex, content, confidence: columnIndex >= 4 ? tickConfidence : 0.99 })),
            ),
          },
        ],
        '2026-10-06',
      );
      return result.ok ? [result.days[0]!.v2?.weatherAm, result.days[0]!.v2?.weatherPm] : null;
    };
    // 0.69 is what Azure returned for the ticks on EQR-2026-0013.
    expect(read(0.69)).toEqual(['C', 'C']);
    expect(read(0.5)).toEqual([null, null]);
  });

  it('leaves a v2 sheet exactly as before: no v3 block, TOTAL is the reading', () => {
    const result = parseEdtrSheet([table([['03/01', '07:00', '11:00', '', '', '', '', '4', '']])], CAPTURE);
    expect(result.ok && result.days[0]!.v3).toBeUndefined();
    expect(result.ok && result.days[0]!.hoursActive).toBe(4);
  });
});
