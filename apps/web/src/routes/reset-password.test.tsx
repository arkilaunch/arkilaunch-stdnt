import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';

describe('ResetPasswordPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('explains a link without a recovery token', async () => {
    await renderRoute('/reset-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
  });

  it('sends the recovery token and new password, then returns to sign in', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '#access_token=recovery-jwt&type=recovery';
    const { router } = await renderRoute('/reset-password');

    await userEvent.type(await screen.findByLabelText(/^new password/i), 'a-brand-new-pass');
    await userEvent.type(screen.getByLabelText(/^confirm password/i), 'a-brand-new-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/auth/reset-password'))!;
    expect(String(url)).toContain('/auth/reset-password');
    expect(JSON.parse(init.body)).toEqual({ accessToken: 'recovery-jwt', password: 'a-brand-new-pass' });
  });
});
