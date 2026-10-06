import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken, clearTokens } from '../lib/auth-client.js';
import { addToCart, clearCart, defaultRentalWindow } from '../lib/cart-client.js';
import { localDate } from '../components/availability-days.js';

const PRICED = { id: '11111111-1111-1111-1111-111111111111', model: 'JCB 3CX', rateValue: 1500 };
const UNPRICED = { id: '22222222-2222-2222-2222-222222222222', model: 'CAT 320D', rateValue: null };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const href = String(url);
      if (href.includes('/availability')) return Promise.resolve(new Response('{}', { status: 500 }));
      const body = href.includes('/users/me')
        ? { tenantName: 'Almara' }
        : href.includes('/me/companies')
          ? [{ id: 'c1', companyName: 'Acme', kycStatus: 'approved' }]
          : href.includes('sites')
            ? []
            : href.includes('/catalog/rates')
              ? { items: [PRICED, UNPRICED].map((eq) => ({ equipmentId: eq.id, rateValue: eq.rateValue })) }
              : { items: [PRICED, UNPRICED] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

describe('/account/cart cost summary', () => {
  it('edits one item independently while keeping undated items expanded', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    act(() => {
      addToCart({ equipmentId: PRICED.id, model: PRICED.model, ...defaultRentalWindow() });
      addToCart({ equipmentId: UNPRICED.id, model: UNPRICED.model, ...defaultRentalWindow() });
      addToCart({ equipmentId: PRICED.id, model: PRICED.model, start: '', end: '' });
    });
    const { unmount } = await renderRoute('/account/cart');
    await screen.findByRole('heading', { name: 'Cost summary' });
    expect(screen.getAllByTestId('cart-dates-summary')).toHaveLength(2);
    const editors = screen.getAllByTestId('cart-dates-editor');
    expect(editors[0]).toHaveClass('hidden');
    expect(editors[1]).toHaveClass('hidden');
    expect(editors[2]).not.toHaveClass('hidden');
    expect(screen.getAllByText('Choose rental dates').length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit dates' })[0]!);
    expect(editors[0]).not.toHaveClass('hidden');
    expect(editors[1]).toHaveClass('hidden');
    expect(screen.getByTestId('cart-mobile-actions')).toBeInTheDocument();
    unmount();
  });

  it('keeps the calendar open after the first endpoint and folds it after the second', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    const window = defaultRentalWindow();
    act(() => addToCart({ equipmentId: PRICED.id, model: PRICED.model, ...window }));
    const { unmount } = await renderRoute('/account/cart');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit dates' }));
    const editor = screen.getByTestId('cart-dates-editor');
    await userEvent.click(editor.querySelector<HTMLButtonElement>(`[data-date="${localDate(new Date(window.start))}"]`)!);
    expect(editor).not.toHaveClass('hidden');
    await userEvent.click(editor.querySelector<HTMLButtonElement>(`[data-date="${localDate(new Date(window.end))}"]`)!);
    expect(editor).toHaveClass('hidden');
    expect(screen.getByTestId('cart-dates-summary')).toBeInTheDocument();
    unmount();
  });

  it('keeps invalid selected dates and hours expanded', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    act(() => addToCart({ equipmentId: PRICED.id, model: PRICED.model, ...defaultRentalWindow(), hours: 1000 }));
    const { unmount } = await renderRoute('/account/cart');
    await screen.findByRole('heading', { name: 'Cost summary' });
    expect(screen.getByTestId('cart-dates-editor')).not.toHaveClass('hidden');
    expect(screen.queryByTestId('cart-dates-summary')).not.toBeInTheDocument();
    expect(screen.getByText(/At most .* hours fit/)).toBeInTheDocument();
    unmount();
  });

  it('folds selected dates on mobile, lets them be edited, and keeps desktop controls available', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    act(() => addToCart({ equipmentId: PRICED.id, model: PRICED.model, ...defaultRentalWindow() }));
    const { unmount } = await renderRoute('/account/cart');
    const summary = await screen.findByTestId('cart-dates-summary');
    expect(summary).toHaveClass('md:hidden');
    expect(summary).toHaveTextContent(/\d{2}-\d{2} to \d{2}-\d{2}.*\d+d \/ \d+h/);
    expect(screen.getByTestId('cart-dates-editor')).toHaveClass('hidden', 'md:flex');
    const bar = screen.getByTestId('cart-mobile-actions');
    expect(bar).toHaveClass('fixed', 'bottom-0', 'md:hidden');
    expect(bar).toHaveTextContent('Estimated rent');
    expect(within(bar).getByRole('button', { name: 'Request a quote' })).toHaveAttribute('form', 'cart-quote-form');
    await userEvent.click(within(summary).getByRole('button', { name: 'Edit dates' }));
    expect(screen.getByTestId('cart-dates-editor')).not.toHaveClass('hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Done editing dates' }));
    expect(screen.getByTestId('cart-dates-editor')).toHaveClass('hidden');
    unmount();
  });

  it('hides the mobile action bar for an empty cart', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    clearCart();
    const { unmount } = await renderRoute('/account/cart');
    await screen.findByRole('heading', { name: 'Shopping cart' });
    expect(screen.queryByTestId('cart-mobile-actions')).not.toBeInTheDocument();
    unmount();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
    clearCart();
  });

  it('breaks the cost down per machine when the cart holds several', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    act(() => {
      addToCart({ equipmentId: PRICED.id, model: PRICED.model, ...defaultRentalWindow() });
      addToCart({ equipmentId: UNPRICED.id, model: UNPRICED.model, ...defaultRentalWindow() });
    });
    const { unmount } = await renderRoute('/account/cart');

    const list = await screen.findByRole('list', { name: 'Cost per machine' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(await within(rows[0]!).findByText(/₱/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Priced in quote')).toBeInTheDocument();
    unmount();
  });

  it('keeps the plain summary for a single machine', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stubFetch();
    act(() => addToCart({ equipmentId: PRICED.id, model: PRICED.model, ...defaultRentalWindow() }));
    const { unmount } = await renderRoute('/account/cart');

    await screen.findByRole('heading', { name: 'Cost summary' });
    expect(screen.queryByRole('list', { name: 'Cost per machine' })).not.toBeInTheDocument();
    unmount();
  });
});
