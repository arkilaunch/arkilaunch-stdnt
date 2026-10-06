import { ApiError, apiErrorText, payloadField } from './api-client.js';

export interface EdtrErrorExplanation {
  readonly title: string;
  readonly detail: string;
}

export function explainEdtrError(error: unknown): EdtrErrorExplanation {
  switch (payloadField(error, 'error')) {
    case 'reconciliation_not_found':
      return {
        title: 'No such reconciliation',
        detail:
          'Nothing in this tenant matches that reconciliation ID. Check it against the review queue -- a reconciliation belonging to another tenant is not visible here.',
      };
    case 'reconciliation_belongs_to_other_edtr':
      return {
        title: 'That reconciliation belongs to a different field log',
        detail: `It is attached to log ${String(payloadField(error, 'edtrId') ?? '').slice(0, 8)}. Approve it from that log.`,
      };
    case 'reconciliation_discrepancy':
      return {
        title: 'The two logs disagree',
        detail:
          'Nothing has been deducted. Enter both adjustment fields with the hours you are approving, then submit again -- a discrepancy can only clear on an explicit human decision.',
      };
    case 'already_approved':
      return {
        title: 'Already approved',
        detail: 'This pair was approved before, and the deposit was deducted then. Nothing changed just now.',
      };
    case 'not_approvable':
      return {
        title: 'Not ready to approve',
        detail:
          'This log has no counterpart yet, so there is nothing to reconcile against. A second, independently recorded log for the same machine and day has to arrive first.',
      };
    case 'deposit_exhausted':
      return {
        title: 'Deposit would go negative',
        detail: 'The deduction is larger than what is left on the deposit, so it was refused and no money moved.',
      };
    case 'rate_card_not_effective':
      return {
        title: 'No rate card covers that date',
        detail:
          'Rate cards exist for this equipment but none is effective on the report date, so the hours cannot be priced. Nothing was deducted.',
      };
    case 'equipment_not_deployed':
      return {
        title: 'That machine is not on site',
        detail:
          'Field logs are recorded only for a machine that is on site now on this booking. Pick it from the list, or ask the office to mark it delivered first.',
      };
    case 'sheet_unit_out_of_scope':
      return {
        title: 'This sheet is for another machine',
        detail:
          "The sheet's QR code names a booking or machine that is not on site at your sites. Check you photographed the right sheet.",
      };
    case 'line_items_required':
      return {
        title: 'Transcribed hours are needed',
        detail:
          'Automatic extraction is switched off in this environment, so a scanned sheet has to be accompanied by the hours read off it.',
      };
    case 'line_items_not_accepted':
      return {
        title: 'Remove the typed hours',
        detail:
          'Automatic extraction is enabled here, so the scan alone is captured and the hours come from the extractor.',
      };
    case 'report_date_outside_rental':
      return {
        title: 'That day is outside the rental',
        detail: 'Pick a day between the rental start and its return, or check the machine was on this rental that day.',
      };
    case 'site_not_assigned':
      return {
        title: 'You are not assigned to this site',
        detail: 'Ask the office to add you as a timekeeper for this site, then record the log again.',
      };
    case 'file_required':
      return { title: 'The scan is missing', detail: 'A paper log needs the photographed or uploaded sheet attached.' };
    default:
      return {
        title: 'That did not go through',
        // A plain Error is our own validation message; a TypeError is a raw network failure.
        detail:
          error instanceof ApiError
            ? apiErrorText(error)
            : error instanceof Error && error.name === 'Error'
              ? error.message
              : 'Try again in a moment.',
      };
  }
}

// The worker's reason for giving up on a sheet (edtr.last_error), in words a timekeeper can act on.
export function failureText(reason: string | null | undefined): string {
  if (!reason) return 'The sheet could not be read.';
  const [code, rows] = reason.split(':');
  // The worker names days by date (2026-10-11); a timekeeper reads them as the sheet prints them (10/11).
  const days = rows?.split(',').map((d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : d));
  const where = days ? ` (for ${days.join(', ')})` : '';
  switch (code) {
    case 'missing_raw_file_uri':
      return 'The photo never finished uploading. Take it again.';
    case 'no_timesheet_table':
      return 'No timesheet was found in the photo. Take it again flat and straight, with the whole sheet in the frame.';
    case 'unreadable_date':
      return `A date could not be read clearly${where}. Write it clearly and retake, or type the hours in.`;
    case 'unreadable_total_hours':
      return `The hours could not be read clearly${where}. Retake in better light, or type the hours in.`;
    case 'duplicate_date':
      return `The same date is written twice${days ? ` (${days.join(', ')})` : ''}. Correct the sheet and retake.`;
    case 'no_dated_rows':
      return 'No filled-in days were found on the sheet.';
    default:
      return 'The sheet could not be read.';
  }
}
