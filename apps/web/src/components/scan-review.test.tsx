import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ParsedColumns, rotateBox } from './scan-review.js';

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

describe('rotateBox', () => {
  // A box near the top-left corner of the page.
  const box = { left: 0.1, top: 0.2, width: 0.3, height: 0.1 };

  it('follows the page a quarter turn clockwise, and comes back after four', () => {
    const quarter = rotateBox(box, 90);
    expect(quarter.left).toBeCloseTo(0.7);
    expect(quarter.top).toBeCloseTo(0.1);
    expect([quarter.width, quarter.height]).toEqual([0.1, 0.3]);
    let turned = box;
    for (let i = 0; i < 4; i++) turned = rotateBox(turned, 90);
    expect(turned.left).toBeCloseTo(box.left);
    expect(turned.top).toBeCloseTo(box.top);
  });

  it('agrees that two quarter turns are a half turn', () => {
    const twice = rotateBox(rotateBox(box, 90), 90);
    const half = rotateBox(box, 180);
    expect(twice.left).toBeCloseTo(half.left);
    expect(twice.top).toBeCloseTo(half.top);
  });
});
