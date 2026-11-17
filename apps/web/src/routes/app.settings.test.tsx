import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/toast.js';
import { DEFAULT_RENTAL_TERMS } from '@arkilaunch/shared';
import { RentalTermsForm, ReturnReminderSettingsForm } from './app.settings.js';

let saved: unknown = null;

beforeEach(() => {
  saved = null;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (String(url).includes('/bookings/return-reminders') && init?.method === 'PUT') {
        saved = JSON.parse(String(init.body));
        return json(saved);
      }
      return json(saved ?? { daysBefore: [5, 3, 1], overdue: true });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ReturnReminderSettingsForm />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Return reminder settings', () => {
  it('shows the baseline and saves the ticked days and overdue switch', async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText('5 days before, 3 days before, 1 day before')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit return reminders/i }));
    await user.click(screen.getByLabelText('7 days before'));
    await user.click(screen.getByLabelText('3 days before'));
    await user.click(screen.getByRole('checkbox', { name: /alert when a machine is overdue/i }));
    await user.click(screen.getByRole('button', { name: 'Save return reminders' }));

    await waitFor(() => expect(saved).toEqual({ daysBefore: [5, 1, 7], overdue: false }));
    expect(await screen.findByText('7 days before, 5 days before, 1 day before')).toBeInTheDocument();
  });
});

describe('Rental agreement settings', () => {
  it('shows the platform template and saves the tenant text', async () => {
    let put: unknown = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
        if (init?.method === 'PUT') {
          put = JSON.parse(String(init.body));
          return json({ version: 'v1', body: (put as { body: string }).body, isDefault: false });
        }
        return json(put ? { version: 'v1', body: (put as { body: string }).body, isDefault: false } : DEFAULT_RENTAL_TERMS);
      }),
    );
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RentalTermsForm />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Platform template/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit rental agreement/i }));
    const box = screen.getByLabelText('Agreement text');
    await user.clear(box);
    await user.type(box, 'Short');
    expect(screen.getByRole('button', { name: 'Save rental agreement' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'Our terms. '.repeat(30) } });
    await user.click(screen.getByRole('button', { name: 'Save rental agreement' }));
    await waitFor(() => expect(put).toEqual({ body: 'Our terms. '.repeat(30) }));
    expect(await screen.findByText('Your own')).toBeInTheDocument();
  });
});
