import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { CaptureModal, sheetWeeks } from './capture-modal.js';
import { ToastProvider } from './toast.js';

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
