import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });

it('labels an extension invoice and offers the existing checkout flow', async () => {
  setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
  const id = '11111111-1111-4111-8111-111111111111';
  const invoice = { id, rentalId: id, truckRequestId: null, bookingCode: 'EQR-2026-0001',
    invoiceType: 'extension', amount: 1200, status: 'issued', dueDate: new Date(), createdAt: new Date(),
    lineItems: [], billTo: null, edtrEvidence: null, receiptNo: null, auditTrail: [] };
  const fetcher = vi.fn((url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(
    String(url).endsWith('/checkout') ? { checkoutUrl: null } : String(url).includes(`/invoices/${id}`) ? invoice : [],
  ), { status: 200 })));
  vi.stubGlobal('fetch', fetcher);
  await renderRoute(`/account/invoices/${id}`);
  expect((await screen.findAllByText('Rental extension')).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Pay now' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Pay in cash' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith(`/me/invoices/${id}/checkout`))).toBe(true));
  const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/checkout'))!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ cash: true });
});
