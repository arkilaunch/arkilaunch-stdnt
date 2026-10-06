import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EdtrDetailResponse } from '@arkilaunch/shared';
import { ParsedColumns, ScanReview, rotateBox } from './scan-review.js';

vi.mock('../lib/api-client.js', () => ({ apiGet: vi.fn().mockResolvedValue({ url: 'https://storage.test/scan.jpg' }) }));
vi.mock('../lib/document-scanner.js', () => ({
  rotateImage: vi.fn().mockResolvedValue('data:image/jpeg;base64,turned'),
  toScannedPage: vi.fn(),
}));

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

describe('ScanReview rotate', () => {
  it('turns clockwise a quarter per click, loops back to upright, and saves each turn', async () => {
    const onRotate = vi.fn();
    const detail = {
      id: '00000000-0000-4000-8000-000000000001',
      status: 'review',
      source: 'paper_ocr',
      lineItems: [],
      fields: [],
      reconciliation: null,
      extraction: null,
      weather: null,
      reportDate: '2026-10-07',
      failureReason: null,
      // An older API without the field must still turn.
    } as unknown as EdtrDetailResponse;
    render(<ScanReview detail={detail} onRotate={onRotate} />);

    const button = await screen.findByRole('button', { name: /rotate clockwise 90 degrees, now at 0/i });
    for (const expected of [90, 180, 270, 0]) {
      await userEvent.click(button);
      expect(screen.getByRole('button', { name: new RegExp(`now at ${expected} degrees`) })).toBe(button);
    }
    expect(onRotate.mock.calls.map(([d]) => d)).toEqual([90, 180, 270, 0]);
  });
});
