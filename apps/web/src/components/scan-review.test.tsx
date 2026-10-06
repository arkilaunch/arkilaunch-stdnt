import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ParsedColumns } from './scan-review.js';

describe('ParsedColumns', () => {
  it('shows every sheet column, marks Running as the billed one, and keeps blank apart from zero', () => {
    render(
      <ParsedColumns
        item={{
          hoursActive: 7.5,
          hoursIdle: 0,
          hoursBreakdown: null,
          hoursWeather: 1,
          hoursOtherDowntime: null,
          hoursTotal: 8.5,
          hourMeterStart: 1200,
          hourMeterEnd: 1207.5,
          reviewFlags: ['sheet_qr_mismatch'],
        }}
      />,
    );

    const running = screen.getByRole('row', { name: /running/i });
    expect(within(running).getByText('(billed)')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(8);
    // Breakdown was never written: a dash, not a fabricated 0.
    expect(within(screen.getByRole('row', { name: /breakdown/i })).getByText('--')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /hour meter end/i })).getByText('1207.5')).toBeInTheDocument();
    expect(screen.getByText('The sheet QR names a different booking or machine.')).toBeInTheDocument();
  });
});
