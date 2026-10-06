import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { CaptureModal, sheetWeeks } from './capture-modal.js';
import { ToastProvider } from './toast.js';

// The scanner pipeline needs a camera and canvas: hand the modal a photo directly, and read its QR as the sheet's.
vi.mock('./capture-field.js', () => ({
  CaptureField: ({ onChange }: { onChange: (f: File) => void }) => (
    <button type="button" onClick={() => onChange(new File(['x'], 'sheet.jpg', { type: 'image/jpeg' }))}>
      pick photo
    </button>
  ),
}));
vi.mock('../lib/sheet-qr.js', () => ({
  readSheetQr: async () => 'ARKI-EDTR3:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333:2026-07-27',
}));

const LOG_ID = '11111111-1111-4111-8111-111111111111';
const unit = (equipmentId: string, serialNo: string) => ({ equipmentId, name: 'Excavator · CAT 320D', serialNo, onSite: true });
const TARGET = {
  rentalId: 'rental-1', bookingCode: 'EQR-1', status: 'active', customerName: 'Almara', siteId: 's', siteName: 'Taytay, Rizal',
  startDate: '2026-08-01T00:00:00.000Z', endDate: null, units: [unit('eq-1', 'SN-1'), unit('eq-2', 'SN-2')],
};

function Harness() {
  const [renders, setRenders] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setRenders((n) => n + 1)}>
        rerender {renders}
      </button>
      <CaptureModal
        open
        onClose={() => {}}
        onCaptured={() => {}}
      />
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('CaptureModal', () => {
  it('makes staff choose the machine, polls /edtr/:id once and locks Record after success', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (url.includes('/reference/capabilities')) return json({ ocrPipeline: false });
      if (url.includes('/field/scan-targets')) return json({ items: [TARGET] });
      if (init?.method === 'POST') return json({ id: LOG_ID, pollUrl: `/api/v1/edtr/${LOG_ID}` });
      return json({ id: LOG_ID, status: 'reconciled', lineItems: [], fields: [], reconciliation: null });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </QueryClientProvider>,
    );

    // The only site is picked for them; with two machines on it, the machine is theirs to choose.
    await waitFor(() => expect(screen.getByRole('combobox', { name: /site and booking/i })).toHaveTextContent('Taytay, Rizal · EQR-1 · Almara'));
    expect(screen.getByRole('combobox', { name: /machine on site/i })).toHaveTextContent('Choose the machine');
    await userEvent.click(screen.getByRole('button', { name: /day worked/i }));
    const calendar = screen.getByRole('dialog', { name: 'Choose day worked' });
    const [month, year] = calendar.querySelectorAll('select[aria-hidden]');
    fireEvent.change(year!, { target: { value: '2026' } });
    fireEvent.change(month!, { target: { value: '09' } });
    await userEvent.click(screen.getByRole('button', { name: /september 1, 2026/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Select date' }));
    const record = screen.getByRole('button', { name: 'Record log' });
    expect(record).toBeDisabled();

    fireEvent.change(document.querySelector('select[aria-hidden] option[value="eq-1"]')!.parentElement!, {
      target: { value: 'eq-1' },
    });
    await userEvent.click(record);

    expect(await screen.findByText(/recorded as/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /rerender/ }));

    const gets = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes(`/edtr/${LOG_ID}`));
    expect(gets).toEqual([`/api/v1/edtr/${LOG_ID}`]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record log' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();

    fireEvent.submit(screen.getByRole('button', { name: /day worked/i }).closest('form')!);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('shows a timekeeper the sheet header, then only "sent" or a retake prompt after submit', async () => {
    const RENTAL = '22222222-2222-4222-8222-222222222222';
    const UNIT = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (url.includes('/reference/capabilities')) return json({ ocrPipeline: true });
      if (url.includes('/field/scan-targets')) return json({ items: [{ ...TARGET, rentalId: RENTAL, units: [unit(UNIT, 'SN-7')] }] });
      if (url.includes('/edtr-sheet')) {
        return json({
          rentalId: RENTAL, chargeTo: 'Almara', projectLocation: 'Taytay, Rizal', bookingCode: 'EQR-1', siteRep: 'Ana Reyes',
          rentalStart: '2026-08-01T00:00:00.000Z', rentalEnd: null,
          equipment: [{ id: UNIT, type: 'Excavator', model: 'CAT 320D', serialNo: 'SN-7', start: '2026-08-01T00:00:00.000Z', end: null, operatorName: 'Juan Cruz', lastHourMeter: 1234.5 }],
        });
      }
      if (init?.method === 'POST') return json({ id: LOG_ID, pollUrl: `/api/v1/edtr/${LOG_ID}` });
      if (url.includes(`/edtr/${LOG_ID}`)) {
        return json({ id: LOG_ID, source: 'paper_ocr', status: polls++ ? 'hard_failed' : 'extracted', failureReason: null,
          lineItems: [{ hoursActive: 8 }], fields: [{ name: 'running', value: 8, confidence: 0.5 }], reconciliation: { status: 'single_source' } });
      }
      return json({});
    });
    let polls = 0;
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <CaptureModal open onClose={onClose} onCaptured={() => {}} initialSource="paper_ocr" submitOnly />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'pick photo' }));
    await screen.findByText(/matched from the sheet/i);
    fireEvent.change(document.querySelector('select[aria-hidden] option[value="2026-07-27"]')!.parentElement!, {
      target: { value: '2026-07-27' },
    });
    expect(await screen.findByText('Juan Cruz')).toBeInTheDocument();
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.getByText('1234.5')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Record log' }));
    expect(await screen.findByText(/sent to the office\. you can close this/i)).toBeInTheDocument();
    expect(screen.queryByText(/reading the sheet|recorded as|second record/i)).not.toBeInTheDocument();
    // The worker gives up on the photo: only then does the timekeeper hear back, to retake it.
    expect(await screen.findByRole('button', { name: 'Retake the photo' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/recorded as/i)).not.toBeInTheDocument();
  });

  it('picks the only machine on the only site, and offers nothing that is not on site', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (url.includes('/field/scan-targets')) return json({ items: [{ ...TARGET, units: [unit('eq-9', 'SN-9')] }] });
      return json({ ocrPipeline: false });
    }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <CaptureModal open onClose={() => {}} onCaptured={() => {}} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('combobox', { name: /machine on site/i })).toHaveTextContent('SN-9'));
  });
});

describe('sheetWeeks', () => {
  it('lists the Monday of each rental week up to today', () => {
    expect(sheetWeeks('2026-09-23', '2026-10-30', '2026-10-06')).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(sheetWeeks('2026-09-23', '2026-09-27', '2026-10-06')).toEqual(['2026-09-21']);
  });
});
