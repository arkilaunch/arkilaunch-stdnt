import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { ToastProvider } from './toast.js';
import { DeliveryCard, PendingRequests } from './booking-actions.js';

const assignmentId = '66666666-6666-4666-8666-666666666666';
const booking: BookingDetailResponse = {
  id: '11111111-1111-4111-8111-111111111111', code: 'EQR-2026-0001', status: 'active',
  projectSiteId: '22222222-2222-4222-8222-222222222222', customerId: '33333333-3333-4333-8333-333333333333',
  siteCity: 'Pasig', siteProvince: null, trackerUrl: '/orders/x', siteContact: null, siteNotes: null,
  callRequestedAt: null, callConfirmedAt: null, createdAt: new Date(), quotation: null,
  deposit: { required: null, totalDeducted: 0, deductions: [] }, invoices: [], payments: [],
  items: [{ id: assignmentId, equipmentId: '44444444-4444-4444-8444-444444444444', equipmentName: 'Excavator',
    start: new Date(), end: new Date(), status: 'active', returnConditionNotes: null, returnNeedsRepair: false }],
  changeRequests: [{ id: '55555555-5555-4555-8555-555555555555', kind: 'extend', assignmentId,
    requestedEnd: new Date(), reason: null, status: 'pending', suggestedChargePhp: 1200,
    chargePhp: null, invoiceId: null, createdAt: new Date() }],
};

afterEach(() => vi.unstubAllGlobals());

function renderRequests(data = booking, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<QueryClientProvider client={client}>
    <ToastProvider><PendingRequests booking={data} /></ToastProvider>
  </QueryClientProvider>);
}

describe('extension approval', () => {
  it.each(['Approve', 'Decline'])('refreshes both booking ledgers after %s without invalidating another rental', async (decision) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = [['booking', booking.id], ['statement', 'staff', booking.id], ['statement', 'me', booking.id]];
    for (const key of keys) client.setQueryData(key, { balanceDue: 0 });
    const unrelated = ['statement', 'staff', 'another-rental'];
    client.setQueryData(unrelated, { balanceDue: 0 });
    renderRequests(booking, client);
    await userEvent.click(screen.getByRole('button', { name: decision }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: decision }));
    await waitFor(() => {
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    });
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it('approves an extension without a charge or checkout request', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetcher);
    renderRequests();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).queryByLabelText(/Extra charge/)).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ decision: 'approved' });
  });

  it('approves without a suggested charge when no quotation exists', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetcher);
    renderRequests({ ...booking, changeRequests: [{ ...booking.changeRequests[0]!, suggestedChargePhp: null }] });
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  });
});

describe('booking return', () => {
  it('keeps per-unit conditions through the incomplete-log gate and requires confirmation with a reason', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"field_logs_incomplete"}', { status: 409 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><DeliveryCard booking={{ ...booking, items: [...booking.items, {
        ...booking.items[0]!, id: '77777777-7777-4777-8777-777777777777', equipmentName: 'Returned unit', status: 'completed',
      }] }} /></ToastProvider>
    </QueryClientProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Mark returned' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).queryByText('Returned unit')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Condition notes'), ' Track needs inspection ');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Equipment condition' }));
    await userEvent.click(screen.getByRole('option', { name: 'Damaged / needs repair' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark returned' }));
    await within(dialog).findByText(/Field logs are incomplete/);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toEqual({
      units: [{ assignmentId, conditionNotes: 'Track needs inspection', condition: 'damaged' }],
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark returned' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByLabelText('Confirm return with incomplete field logs'));
    await userEvent.type(within(dialog).getByLabelText(/Reason for returning/), 'Paper logs will follow');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark returned' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetcher.mock.calls[1]![1].body))).toEqual({
      units: [{ assignmentId, conditionNotes: 'Track needs inspection', condition: 'damaged' }],
      confirmIncompleteLogs: true, reason: 'Paper logs will follow',
    });
  });
});
