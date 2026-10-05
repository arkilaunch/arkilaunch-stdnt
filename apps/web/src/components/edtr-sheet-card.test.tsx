import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EdtrSheetCard } from './edtr-sheet-card.js';
import { ToastProvider } from './toast.js';

const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));

function mount(role: string, paperSize: 'legal' | 'letter' = 'legal') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('/users/me')) return json({ id: 'u', email: 'a@b.c', role, status: 'active', createdAt: '2026-01-01', tenantName: 'Almara', tenantSlug: 'almara' });
      if (url.includes('/edtr-settings')) return json({ paperSize });
      if (url.includes('/edtr-sheet')) return json({ rentalId: 'r', chargeTo: 'Acme', projectLocation: '', equipment: [] });
      return json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <EdtrSheetCard bookingId="r" printable />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('EdtrSheetCard', () => {
  it('offers the blank sheet to an admin', async () => {
    mount('admin');
    expect(await screen.findByText(/Blank sheet/)).toBeInTheDocument();
  });

  // QA 33: the blank template carries no booking data, so field staff may print it for sampling too.
  it('offers the blank sheet to a timekeeper as well', async () => {
    mount('timekeeper');
    const group = await screen.findByRole('group', { name: /Blank sheet/ });
    expect(within(group).getByRole('button', { name: 'PDF' })).toBeInTheDocument();
  });

  it('starts the paper choice at the company default', async () => {
    mount('admin', 'letter');
    await waitFor(() => expect(screen.getByRole('combobox', { name: /paper/i })).toHaveTextContent(/Letter/));
  });
});
