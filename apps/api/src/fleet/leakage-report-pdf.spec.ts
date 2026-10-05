import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { LeakageFinding, LeakageReport } from '@arkilaunch/shared';
import { formatKpi, renderLeakageReportPdf } from './leakage-report-pdf.js';

const finding = (i: number, records: number): LeakageFinding => ({
  key: `leak-${i}`,
  title: `Leak ${i}`,
  kind: i % 3 === 0 ? 'opportunity' : i % 2 ? 'delayed' : 'lost',
  severity: 'high',
  amountPhp: 1000 * i,
  count: records,
  whyItMatters: 'Why this costs money, long enough to wrap across more than a single printed line of the report body in the PDF.',
  whatToDo: 'The next step that recovers it.',
  howMeasured: 'How the figure was worked out.',
  records: Array.from({ length: records }, (_, r) => ({ label: `Booking ${r}`, detail: `detail ${r}`, amountPhp: 100 * r })),
});

const report = (findings: number, records = 3): LeakageReport => ({
  period: { from: '2026-09-01', to: '2026-09-30' },
  filters: { customer: null, equipmentType: null },
  generatedAt: '2026-09-30T05:00:00.000Z',
  summary: {
    invoiced: 500_000, collected: 400_000, outstanding: 100_000, collectionRatePct: 80, verifiedRevenue: 120_000,
    atRisk: { total: 30_000, lost: 10_000, delayed: 15_000, opportunity: 5_000 },
    topActions: [{ title: 'Leak 1', amountPhp: 1000, whatToDo: 'Do the thing.' }],
  },
  kpis: [
    { label: 'Collection rate', value: 80, unit: 'pct', meaning: 'Share collected.' },
    { label: 'Average days to pay', value: null, unit: 'days', meaning: 'Days to pay.' },
  ],
  findings: Array.from({ length: findings }, (_, i) => finding(i + 1, records)),
  master: { fleetTotal: 6, fleetByStatus: { available: 4, maintenance: 2 }, maintenanceDue: 2, customersTotal: 9, customersKycApproved: 7, projectSites: 5 },
  ledger: {
    bookings: { count: 3, byStatus: { active: 2, completed: 1 } },
    quotations: 4,
    truckTrips: 1,
    invoicesByType: { booking: 300_000, weekly: 200_000 },
    payments: { count: 3, paid: 400_000 },
    depositDeductions: { count: 2, amount: 120_000 },
  },
});

const brand = { name: 'Almara Construction', address: 'Quezon City', contact: '0917 000 0000', tin: null };

describe('renderLeakageReportPdf', () => {
  it('renders a valid PDF titled with its period', async () => {
    const doc = await PDFDocument.load(await renderLeakageReportPdf(report(9), brand));
    expect(doc.getTitle()).toBe('Revenue Leakage Report 2026-09-01 to 2026-09-30');
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('prints the tenant icon on the letterhead, and survives a corrupt one', async () => {
    // 1x1 transparent PNG.
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
    const withLogo = await renderLeakageReportPdf(report(2), { ...brand, logo: png });
    expect(Buffer.from(withLogo).toString('latin1')).toContain('/Subtype /Image');
    await expect(renderLeakageReportPdf(report(2), { ...brand, logo: png.slice(0, 12) })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('flows onto more pages instead of running off the bottom', async () => {
    const doc = await PDFDocument.load(await renderLeakageReportPdf(report(9, 5), brand));
    expect(doc.getPageCount()).toBeGreaterThan(2);
  });

  it('renders a period with no leaks and no activity without throwing', async () => {
    const empty = { ...report(0), summary: { ...report(0).summary, topActions: [] }, ledger: { ...report(0).ledger, invoicesByType: {}, bookings: { count: 0, byStatus: {} } } };
    await expect(renderLeakageReportPdf(empty, brand)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('formatKpi', () => {
  it('says so instead of printing a zero it cannot vouch for', () => {
    expect(formatKpi({ label: 'x', value: null, unit: 'php', meaning: '' })).toBe('No data in period');
    expect(formatKpi({ label: 'x', value: 80, unit: 'pct', meaning: '' })).toBe('80.0%');
    expect(formatKpi({ label: 'x', value: 12.25, unit: 'days', meaning: '' })).toBe('12.3 days');
  });
});
