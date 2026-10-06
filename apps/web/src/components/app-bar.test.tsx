import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

const UNREAD = {
  id: 'n-1', notificationType: 'booking_created', status: 'unread', payload: {}, createdAt: '2026-09-20T02:00:00.000Z', readAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Notification bell', () => {
  it('tells a screen reader which items are unread', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body = String(url).includes('/notifications') ? { items: [UNREAD], total: 1 } : { items: [], total: 0 };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    await renderRoute('/app/payments');

    await userEvent.click(await screen.findByRole('button', { name: /^Notifications, 1 unread/ }));
    const panel = await screen.findByRole('region', { name: 'Latest notifications' });
    expect(await within(panel).findByText('Unread:')).toHaveClass('sr-only');
  });
});

describe('Phone navigation menu', () => {
  it('drops under the bar, names the tenant only for screen readers, and closes on Escape', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }))));
    await renderRoute('/app/payments');

    const toggle = await screen.findByRole('button', { name: 'Toggle navigation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('app-mobile-nav')).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const menu = document.getElementById('app-mobile-nav')!;
    expect(within(menu).getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');

    await userEvent.keyboard('{Escape}');
    expect(document.getElementById('app-mobile-nav')).toBeNull();
    expect(toggle).toHaveFocus();
  });
});
