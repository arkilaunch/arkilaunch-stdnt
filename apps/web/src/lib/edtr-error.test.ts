import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client.js';
import { explainEdtrError, failureText } from './edtr-error.js';

describe('explainEdtrError', () => {
  it("shows our own validation message rather than hiding it", () => {
    expect(explainEdtrError(new Error('Enter the running hours.')).detail).toBe('Enter the running hours.');
  });

  it('explains a day outside the rental', () => {
    expect(explainEdtrError(new ApiError(422, { error: 'report_date_outside_rental' })).title).toBe('That day is outside the rental');
  });

  it('renders an unmapped API code as a sentence', () => {
    expect(explainEdtrError(new ApiError(404, { error: 'rental_not_found' })).detail).toBe('Rental not found.');
  });

  it('keeps a raw network failure off the screen', () => {
    expect(explainEdtrError(new TypeError('Failed to fetch')).detail).toBe('Try again in a moment.');
  });
});

describe('failureText', () => {
  it('names the rows the worker could not read, in words a timekeeper can act on', () => {
    expect(failureText('unreadable_total_hours:2026-10-11,2026-10-12')).toBe(
      'The hours could not be read clearly (for 10/11, 10/12). Type the hours in from the sheet.',
    );
    expect(failureText('hours_filled:idle')).toBe(
      "Some hours were worked out from the row's total (idle). Check them against the sheet before approving.",
    );
    expect(failureText('row_mismatch')).toMatch(/do not add up/);
    expect(failureText('no_timesheet_table')).toMatch(/No timesheet was found/);
    expect(failureText('something_new')).toBe('The sheet could not be read.');
    expect(failureText(null)).toBe('The sheet could not be read.');
  });
});
