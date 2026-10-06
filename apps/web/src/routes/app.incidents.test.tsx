import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const INCIDENT = {
  id: '22222222-2222-4222-8222-222222222222',
  projectSiteId: null,
  siteCity: 'Pasig',
  siteProvince: 'Metro Manila',
  severity: 'high',
  observed: null,
  occurredAt: '2026-10-03T03:00:00.000Z',
  kind: 'used_despite_warning',
  detail: '8 h logged on 2026-10-03 while the field log itself marks heavy rain (AM).',
  edtrId: null,
  half: 'am',
  customerId: CUSTOMER,
  customerName: 'Acme Builders',
  source: 'sheet',
  status: 'open',
  reviewNote: null,
  reviewedAt: null,
};

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      calls.push(u);
      const json = (v: unknown) => Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
      if (u.includes('/incidents/companies')) return json({ items: [{ customerId: CUSTOMER, companyName: 'Acme Builders', total: 3, open: 2 }] });
      if (u.includes('/incidents')) return json({ items: [INCIDENT], total: 1 });
      if (u.includes('/users/me')) return json({ role: 'admin' });
      return json({ items: [], total: 0 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Incident log', () => {
  it('names the company, tallies repeat offenders, and filters the log by one', async () => {
    await renderRoute('/app/incidents');
    const company = await screen.findByRole('button', { name: 'Acme Builders: 3 (2 open)' });
    expect(screen.queryByRole('tab', { name: 'Report discrepancies' })).not.toBeInTheDocument();
    await userEvent.click(company);
    expect(calls.some((u) => u.includes(`customerId=${CUSTOMER}`))).toBe(true);
  });

  it('will not dismiss an incident without a note', async () => {
    await renderRoute(`/app/incidents?open=${INCIDENT.id}`);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/the timekeeper marked heavy rain/)).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('combobox', { name: 'Status' }));
    await userEvent.click(screen.getByRole('option', { name: 'Dismissed' }));
    expect(within(drawer).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.type(within(drawer).getByLabelText('Note'), 'Covering, not running.');
    expect(within(drawer).getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
