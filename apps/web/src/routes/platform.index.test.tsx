import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import type { CatalogTenantListItem } from '@arkilaunch/shared';

vi.mock('../lib/host.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/host.js')>()),
  currentHost: { kind: 'platform' },
  tenantSlug: () => null,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Platform directory', () => {
  it('keeps a category picked while the name search is still debouncing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(url).includes('/catalog/tenants')
                ? { items: [], total: 0, categories: ['Excavator'], locations: [] }
                : [],
            ),
            { status: 200 },
          ),
        ),
      ),
    );
    const { router } = await renderRoute('/');
    const chip = await screen.findByRole('button', { name: 'Excavator' });

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'alm' } });
    fireEvent.click(chip);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(router.state.location.search).toMatchObject({ q: 'alm', category: 'Excavator' });
  });
});

const almara: CatalogTenantListItem = { slug: 'almara', name: 'Almara Construction', logoUrl: null, tagline: 'Equipment rentals', city: 'Quezon City', province: null, primaryColor: null, categories: ['Excavator'] };

function catalogFetch(items = [almara]) {
  const fetch = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
    String(url).includes('/catalog/tenants') ? { items, total: items.length, categories: ['Excavator'], locations: ['Quezon City'] } : [],
  ), { status: 200 })));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Platform SaaS landing', () => {
  it('prioritizes registration and resolves the featured partner independently of directory filters', async () => {
    const fetch = catalogFetch();
    await renderRoute('/?q=another');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Run your equipment rental business in one place.');
    expect(screen.getAllByRole('link', { name: /Register your company/ }).every((link) => link.getAttribute('href') === '/register')).toBe(true);
    const partner = await screen.findByText('Pilot partner');
    const article = partner.closest('article')!;
    expect(within(article).getByRole('link', { name: /Visit Almara Construction/ })).toHaveAttribute('href', 'http://almara.localhost:3000');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('q=Almara&limit=100'))).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url).includes('q=another'))).toBe(true);
  });

  it('does not feature a similarly named company with a different slug', async () => {
    const fetch = catalogFetch([{ ...almara, slug: 'almara-other' }]);
    await renderRoute('/');
    await screen.findByText('1 company');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Pilot partner')).not.toBeInTheDocument();
  });

  it('falls back to initials when a company logo fails', async () => {
    catalogFetch([{ ...almara, logoUrl: 'https://example.test/broken.png' }]);
    await renderRoute('/');
    const partner = await screen.findByText('Pilot partner');
    const article = partner.closest('article')!;
    fireEvent.error(article.querySelector('img')!);
    expect(article.querySelector('img')).toBeNull();
    expect(within(article).getByText('AC')).toBeInTheDocument();
  });

  it('keeps the product visible and supports retry when the catalog fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))));
    await renderRoute('/');
    await screen.findByText('The directory could not be loaded. Check your connection and try again.');
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    expect(screen.queryByText('Pilot partner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it('closes the mobile disclosure on Escape and restores focus', async () => {
    catalogFetch([]);
    await renderRoute('/');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(close).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it.each(['/help', '/terms', '/privacy'])('makes the platform footer destination %s accessible', async (path) => {
    catalogFetch([]);
    const { router } = await renderRoute(path);
    expect(router.state.location.pathname).toBe(path);
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument();
  });

  it('retains storefront-address prefill when registration starts', async () => {
    catalogFetch([]);
    const { router } = await renderRoute('/');
    fireEvent.change(screen.getByLabelText('Your company name'), { target: { value: 'Sample yard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start registration' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/register'));
    expect(sessionStorage.getItem('arkilaunch.registrationCompanyName')).toBe('Sample yard');
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow'));
    expect(document.head.querySelector('[data-platform-seo]')).toBeNull();
  });
});
