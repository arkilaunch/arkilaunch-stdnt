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

it('shows one numbered weekly usage row per machine and the deposit offset', async () => {
  setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
  const id = '11111111-1111-4111-8111-111111111112';
  const invoice = { id, rentalId: id, truckRequestId: null, bookingCode: 'EQR-2026-0002',
    invoiceType: 'weekly', amount: 6000, status: 'issued', dueDate: new Date(), createdAt: new Date(),
    lineItems: [], billTo: { companyName: 'Ronald De Jesus', tin: null, billingAddress: null }, edtrEvidence: null, receiptNo: null, auditTrail: [],
    rentalStatement: { jobSite: 'San Jose, Antipolo', equipment: ['Backhoe MS70 (SN B-1)', 'Road Roller SV20 (SN R-1)'],
      weekStart: '2026-11-02', weekEnd: '2026-11-08', usageLines: [
        { equipmentId: '00000000-0000-4000-8000-000000000001', label: 'Backhoe MS70', serialNo: 'B-1', hours: 8, unitPrice: 1000, gross: 8000, depositApplied: 5000, net: 3000 },
        { equipmentId: '00000000-0000-4000-8000-000000000002', label: 'Road Roller SV20', serialNo: 'R-1', hours: 6, unitPrice: 500, gross: 3000, depositApplied: 0, net: 3000 },
      ] } };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(invoice), { status: 200 }))));
  await renderRoute(`/account/invoices/${id}`);
  expect(await screen.findByText('San Jose, Antipolo')).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'No.' })).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Particulars' })).toBeVisible();
  expect(screen.getAllByText(/Backhoe MS70/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Road Roller SV20/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Deposit applied: Backhoe MS70/)).toBeVisible();
});
