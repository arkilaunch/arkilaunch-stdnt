import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StorefrontPromotionsForm, StorefrontServices } from './storefront-promotions.js';
import { ToastProvider } from './toast.js';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../lib/api-client.js', async (original) => ({ ...await original<typeof import('../lib/api-client.js')>(), apiGet: api.get, apiPatch: api.patch }));
vi.mock('@tanstack/react-router', async (original) => ({ ...await original<typeof import('@tanstack/react-router')>(), Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => <a href={to} className={className}>{children}</a> }));
const promotion = { enabled: true, amount: 820.25, unit: 'hour', qualification: 'Selected units, minimum eight hours.' };
const clients: QueryClient[] = [];
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>);
  return client;
}
beforeEach(() => { api.get.mockReset(); api.patch.mockReset(); });
afterEach(() => { clients.forEach((client) => client.clear()); clients.length = 0; });

describe('Storefront service promotions', () => {
  it('shows only configured enabled starting prices with qualification and service-specific links', async () => {
    api.get.mockResolvedValue({ equipment: promotion, trucking: { ...promotion, enabled: false, amount: 9999, unit: 'trip' } });
    mount(<StorefrontServices />);
    expect(await screen.findByText(/820\.25/)).toBeInTheDocument();
    expect(screen.getByText(promotion.qualification)).toBeInTheDocument();
    expect(screen.getByText('Final price confirmed in quote.')).toBeInTheDocument();
    expect(screen.getAllByText('As low as')).toHaveLength(1);
    expect(screen.queryByText(/9,999/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore equipment' })).toHaveAttribute('href', '/equipment');
    expect(screen.getByRole('link', { name: 'Request trucking' })).toHaveAttribute('href', '/account/trucks');
    expect(api.get).toHaveBeenCalledWith('/catalog/promotions');
  });

  it('keeps both generic service cards without numeric teasers when promotions are unconfigured', async () => {
    api.get.mockResolvedValue({ equipment: null, trucking: null });
    mount(<StorefrontServices />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Equipment rental' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trucking services' })).toBeInTheDocument();
    expect(screen.queryByText('As low as')).not.toBeInTheDocument();
  });

  it('loads a different tenant’s promotion in a fresh query context without retaining prior prices', async () => {
    api.get.mockResolvedValueOnce({ equipment: promotion, trucking: null });
    const first = mount(<StorefrontServices />);
    expect(await screen.findByText(/820\.25/)).toBeInTheDocument();
    first.clear();
    // A tenant storefront navigation loads a new document and query client.
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    api.get.mockResolvedValueOnce({ equipment: null, trucking: { ...promotion, amount: 1500, unit: 'trip', qualification: 'Local trips only.' } });
    mount(<StorefrontServices />);
    expect(await screen.findByText(/1,500\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/820\.25/)).not.toBeInTheDocument();
    expect(screen.getByText('Local trips only.')).toBeInTheDocument();
  });

  it('validates promotion settings and saves only marketing values, independently of price-book queries', async () => {
    api.get.mockResolvedValue({ equipment: null, trucking: null });
    api.patch.mockResolvedValue({});
    const client = mount(<StorefrontPromotionsForm />);
    client.setQueryDefaults(['price-book'], { gcTime: Infinity });
    client.setQueryData(['price-book'], { hourlyRate: 2000 });
    const equipment = await screen.findByRole('group', { name: 'Equipment rental' });
    await userEvent.click(within(equipment).getByLabelText('Configure starting-price promotion'));
    const price = within(equipment).getByLabelText(/Starting price/);
    const qualification = within(equipment).getByLabelText(/Qualification/);
    await userEvent.clear(price);
    await userEvent.type(price, '0');
    await userEvent.type(qualification, 'Selected machines only.');
    fireEvent.submit(price.closest('form')!);
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.clear(price);
    await userEvent.type(price, '750.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save service promotions' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/tenants/me/promotions', {
      equipment: { enabled: true, amount: 750.5, unit: 'day', qualification: 'Selected machines only.' }, trucking: null,
    }));
    expect(client.getQueryData(['price-book'])).toEqual({ hourlyRate: 2000 });
    expect(client.getQueryState(['price-book'])?.isInvalidated).toBe(false);
  });

  it('retries settings loading failures and retains a readable save error', async () => {
    api.get.mockRejectedValueOnce(new Error('offline'));
    mount(<StorefrontPromotionsForm />);
    await screen.findByRole('button', { name: 'Retry promotions' });
    api.get.mockResolvedValue({ equipment: promotion, trucking: null });
    await userEvent.click(screen.getByRole('button', { name: 'Retry promotions' }));
    await screen.findByRole('heading', { name: 'Service promotions' });
    api.patch.mockRejectedValue(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Save service promotions' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(await screen.findByText('Could not save promotions')).toBeInTheDocument();
    expect(screen.getByLabelText(/Qualification/)).toHaveValue(promotion.qualification);
  });
});
