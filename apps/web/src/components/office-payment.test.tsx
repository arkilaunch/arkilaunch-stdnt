import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './toast.js';
import { OfficePaymentButton } from './office-payment.js';

afterEach(() => vi.unstubAllGlobals());

describe('OfficePaymentButton', () => {
  it('posts the OR number, then hands over to the next step', async () => {
    const fetcher = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response('{"invoiceId":"x","status":"paid"}', { status: 200 })));
    vi.stubGlobal('fetch', fetcher);
    const onPaid = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <OfficePaymentButton path="/truck-requests/t1/mark-paid" what="trip" next="Dispatch the truck." onPaid={onPaid} />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mark as paid (office)' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Mark as paid at the office?' });
    await userEvent.type(within(dialog).getByLabelText('Official receipt (OR) number'), ' OR-123 ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));

    await waitFor(() => expect(onPaid).toHaveBeenCalled());
    const [url, init] = fetcher.mock.calls.at(-1)!;
    expect(String(url)).toContain('/truck-requests/t1/mark-paid');
    expect(JSON.parse(String(init?.body))).toEqual({ receiptNo: 'OR-123' });
  });
});
