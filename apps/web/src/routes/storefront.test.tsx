import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderRoute } from '../test/render-route.js';
import { clearTokens } from '../lib/auth-client.js';

const testimonial = {
  id: '11111111-1111-4111-8111-111111111111',
  headline: 'Service headline',
  quote: '<b>Literal quote</b>',
  authorName: 'Test Author',
  authorTitle: '',
};
function stub(items: object[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const href = String(url);
      const body = href.includes('/catalog/testimonials')
        ? { items }
        : href.includes('/catalog/tenant')
          ? { name: 'Test rentals', tagline: 'Industrial fleet', slug: 'almara' }
          : {
              items: [
                {
                  id: '22222222-2222-4222-8222-222222222222',
                  model: 'Test machine',
                  equipmentTypeName: 'Back Hoe',
                  availabilityStatus: 'available',
                  rateValue: 1500,
                  photoUri: null,
                },
              ],
            };
      return Promise.resolve(new Response(JSON.stringify(body)));
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  clearTokens();
});
describe('tenant storefront', () => {
  it('shows public prices, hides empty testimonials; exposes signed-out Cart', async () => {
    stub([]);
    const view = await renderRoute('/');
    await screen.findByText('Test machine');
    expect(screen.getByText(/1,500\.00 \/ hour/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Testimonials' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Testimonials' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('link', { name: 'Cart' })).toHaveAttribute('href', '/account/cart');
    view.unmount();
  });
  it('renders real rows as text and links to the section', async () => {
    stub([testimonial]);
    const view = await renderRoute('/');
    await screen.findByRole('heading', { name: 'Service headline' });
    expect(screen.getByText(/<b>Literal quote<\/b>/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Testimonials' }).closest('section'),
    ).toHaveAttribute('id', 'testimonials');
    expect(screen.getByRole('link', { name: 'Testimonials' })).toHaveAttribute(
      'href',
      '/#testimonials',
    );
    expect(screen.getByText('TA')).toHaveAttribute('aria-hidden', 'true');
    view.unmount();
  });
  it('shows a guest prices on /equipment', async () => {
    stub([]);
    const view = await renderRoute('/equipment');
    expect(await screen.findByText(/1,500\.00 \/ hour/)).toBeInTheDocument();
    view.unmount();
  });
  it('handles a null headline', async () => {
    stub([{ ...testimonial, headline: null }]);
    const view = await renderRoute('/');
    expect(await screen.findByText('Test Author')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Service headline' })).not.toBeInTheDocument();
    view.unmount();
  });
  it('shows all saved testimonials beyond six', async () => {
    stub(
      Array.from({ length: 7 }, (_, i) => ({
        ...testimonial,
        id: `testimonial-${i}`,
        headline: `Headline ${i}`,
      })),
    );
    const view = await renderRoute('/');
    await screen.findByRole('heading', { name: 'Headline 6' });
    expect(screen.getAllByRole('heading', { name: /^Headline \d/ })).toHaveLength(7);
    view.unmount();
  });

  it('shows how renting works and sends the search to the full catalog', async () => {
    stub([]);
    const view = await renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'How renting works' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Sign and pay')]),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment' }), { target: { value: 'hoe' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/equipment'));
    expect(view.router.state.location.search).toEqual({ q: 'hoe' });
    expect(await screen.findByRole('searchbox', { name: 'Search equipment' })).toHaveValue('hoe');
    view.unmount();
  });
  it('offers a retry when the fleet fails to load, not a blank search miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/catalog/equipment')
            ? new Response('{}', { status: 500 })
            : new Response(JSON.stringify(String(url).includes('/catalog/tenant') ? { name: 'Test rentals', slug: 'almara' } : { items: [] })),
        ),
      ),
    );
    const view = await renderRoute('/');
    expect(await screen.findByText('The equipment list could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/No equipment matches/)).not.toBeInTheDocument();
    view.unmount();
  });
  it('says the fleet is empty instead of a search miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(new Response(JSON.stringify(String(url).includes('/catalog/tenant') ? { name: 'Test rentals', slug: 'almara' } : { items: [] }))),
      ),
    );
    const view = await renderRoute('/');
    expect(await screen.findByText('No machines listed yet')).toBeInTheDocument();
    view.unmount();
  });
});
