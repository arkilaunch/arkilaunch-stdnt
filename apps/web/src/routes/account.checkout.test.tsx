import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { clearTokens, setAccessToken } from '../lib/auth-client.js';

const BOOKING_ID = '33333333-3333-4333-8333-333333333333';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAA';
let checkoutBody: Record<string, unknown> | null = null;

function stub(agreement: object | null) {
  checkoutBody = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const href = String(url);
      const json = (v: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(v), { status }));
      if (href.includes('/checkout')) {
        checkoutBody = JSON.parse(String(init?.body));
        return json({ error: 'rate_limited' }, 429);
      }
      if (href.includes('/rental-terms')) return json({ version: 'v3', body: 'Tenant agreement text.', isDefault: false });
      if (href.includes('/me/companies')) return json([{ id: 'c1', companyName: 'Acme', kycStatus: 'approved' }]);
      if (href.includes('/users/me')) return json({ tenantName: 'Almara' });
      if (href.includes(`/bookings/${BOOKING_ID}`))
        return json({
          id: BOOKING_ID, code: 'BK-1', status: 'pending', customerId: 'c1', items: [], invoices: [], payments: [],
          callConfirmedAt: new Date().toISOString(), callRequestedAt: null, createdAt: new Date().toISOString(),
          quotation: { id: 'q1', revision: 1, status: 'accepted', totalPhp: 1000, createdAt: new Date().toISOString() },
          deposit: { required: 500, totalDeducted: 0, deductions: [] }, agreement,
        });
      return json({});
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearTokens();
});

describe('/account/checkout rental agreement', () => {
  it('keeps Pay disabled until the box, the name and a signature are in, then sends them', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stub(null);
    const view = await renderRoute(`/account/checkout/${BOOKING_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Review and sign' }));
    expect(await screen.findByText('Tenant agreement text.')).toBeInTheDocument();
    const pay = screen.getByRole('button', { name: 'Pay now' });
    expect(pay).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: /agree to this rental agreement/i }));
    await userEvent.type(screen.getByLabelText('Full name'), 'Juan Dela Cruz');
    expect(pay).toBeDisabled();
    const pad = screen.getByRole('img', { name: /signature pad/i });
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(pad);
    expect(pay).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm signature' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pay).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Review signature' }));
    expect(screen.getByLabelText('Full name')).toHaveValue('Juan Dela Cruz');
    expect(screen.getByRole('img', { name: 'Your signature' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm signature' }));

    await userEvent.click(pay);
    await waitFor(() => expect(checkoutBody).toMatchObject({ agreement: { signedName: 'Juan Dela Cruz', termsVersion: 'v3', signaturePng: PNG } }));
    view.unmount();
  });

  it('shows who signed and lets them pay without signing again', async () => {
    setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
    stub({ signedName: 'Juan Dela Cruz', signedAt: new Date().toISOString(), termsVersion: 'v3', signaturePng: PNG });
    const view = await renderRoute(`/account/checkout/${BOOKING_ID}`);
    expect(await screen.findByText(/Signed by Juan Dela Cruz/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeEnabled();
    view.unmount();
  });
});
