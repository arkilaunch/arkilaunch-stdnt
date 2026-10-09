import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeakageReport } from '@arkilaunch/shared';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';
import { exportRows } from './app.insights.js';

const REPORT: LeakageReport = {
  period: { from: '2026-10-01', to: '2026-10-06' },
  filters: { customer: null, equipmentType: null },
  generatedAt: '2026-10-06T00:00:00.000Z',
  summary: {
    invoiced: 100_000, collected: 60_000, outstanding: 40_000, collectionRatePct: 60, verifiedRevenue: 20_000,
    atRisk: { total: 85_000, lost: 72_000, delayed: 5_000, opportunity: 8_000 },
    topActions: [{ title: 'Days on site with no field log', amountPhp: 72_000, whatToDo: 'Ask the timekeeper for the missing sheets.' }],
  },
  kpis: [{ label: 'Collection rate', value: 60, unit: 'pct', meaning: 'Of every peso invoiced, how much is in.' }],
  findings: [
    {
      key: 'missing_logs', title: 'Days on site with no field log', kind: 'lost', severity: 'high', amountPhp: 72_000, count: 1,
      whyItMatters: 'Without a signed sheet there is nothing to bill.', whatToDo: 'Ask the timekeeper for the missing sheets.',
      howMeasured: 'Days without a log times 8 h times the rate.',
      records: [{ label: 'EQR-1 · Almara · CAT 320D (SN-1)', detail: '9 days with no field log', amountPhp: 72_000 }],
    },
    {
      key: 'cash_pending', title: 'Cash promised, not recorded', kind: 'delayed', severity: 'low', amountPhp: 0, count: 0,
      whyItMatters: 'x', whatToDo: 'y', howMeasured: 'z', records: [],
    },
  ],
  master: { fleetTotal: 1, fleetByStatus: {}, maintenanceDue: 0, customersTotal: 1, customersKycApproved: 1, projectSites: 1 },
  ledger: { bookings: { count: 0, byStatus: {} }, quotations: 0, truckTrips: 0, invoicesByType: {}, payments: { count: 0, paid: 0 }, depositDeductions: { count: 0, amount: 0 } },
};

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Reports: revenue leakage', () => {
  it('leads with the pesos at risk, what to do first, then each leak with its why and records', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      Promise.resolve(new Response(JSON.stringify(String(url).includes('/reports/leakage') ? REPORT : []), { status: 200 }))));
    setAccessToken(makeToken(makeValidClaims({ role: 'admin' })));
    await renderRoute('/app/insights');

    expect(await screen.findByText('At risk this period')).toBeInTheDocument();
    expect(screen.getByText('₱85,000.00')).toBeInTheDocument();
    const first = screen.getByRole('region', { name: 'Do these first' });
    expect(within(first).getByText('Ask the timekeeper for the missing sheets.')).toBeInTheDocument();
    expect(screen.getByText('high priority')).toBeInTheDocument();
    expect(screen.getByText('None this period.')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Why it matters, and the records behind it'));
    expect(screen.getByText('9 days with no field log')).toBeVisible();
  });

  it('exports summable numbers: the summary, every leak and its records', () => {
    const rows = exportRows(REPORT);
    expect(rows[0]).toEqual(['Section', 'Item', 'Kind', 'Priority', 'Amount (PHP)', 'Count', 'Detail']);
    expect(rows).toContainEqual(['Summary', 'At risk this period', '', '', 85_000, '', '']);
    expect(rows.find((r) => r[0] === 'Leak' && r[1] === 'Days on site with no field log')?.[4]).toBe(72_000);
    expect(rows.filter((r) => r[0] === 'Record')).toHaveLength(1);
  });
});
