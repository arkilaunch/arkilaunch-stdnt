import type { LeakageKpi, LeakageReport } from '@arkilaunch/shared';
import type { StatementBrand } from '../billing/statement-pdf.js';
import { DocumentPdf } from '../common/document-pdf.js';
const php = (n: number) => `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const KIND: Record<string, string> = { lost: 'Lost unless acted on', delayed: 'Cash delayed', opportunity: 'Missed opportunity' };
export function formatKpi(x: LeakageKpi): string {
  if (x.value === null) return 'No data in period';
  return x.unit === 'php' ? php(x.value) : x.unit === 'pct' ? `${x.value.toFixed(1)}%` : `${x.value.toFixed(1)} days`;
}
export async function renderLeakageReportPdf(r: LeakageReport, brand: StatementBrand): Promise<Uint8Array> {
  const doc = await DocumentPdf.create('Revenue Leakage Report', `${r.period.from} to ${r.period.to}`, brand);
  doc.paragraph('Where money is leaking, what it costs, and what to do about it');
  doc.facts([
    ['Period', `${day(r.period.from)} - ${day(r.period.to)}`], ['Customer', r.filters.customer ?? 'All customers'],
    ['Equipment type', r.filters.equipmentType ?? 'All types'],
    ['Generated', `${new Date(r.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Manila)`],
  ]);
  doc.heading('1. What is at risk');
  doc.paragraph(`${php(r.summary.atRisk.total)} at risk in this period. ${php(r.summary.atRisk.lost)} is earned but will be lost unless someone acts, ${php(r.summary.atRisk.delayed)} is owed but not yet collected, and ${php(r.summary.atRisk.opportunity)} is capacity that earned nothing.`);
  doc.facts([['Invoiced this period', php(r.summary.invoiced)], ['Collected', php(r.summary.collected)], ['Billed from reconciled time records', php(r.summary.verifiedRevenue)]]);
  if (r.summary.topActions.length) {
    doc.heading('Do these first');
    r.summary.topActions.forEach((action, i) => { doc.facts([[`${i + 1}. ${action.title}`, php(action.amountPhp)]]); doc.paragraph(action.whatToDo); });
  } else doc.paragraph('No leaks found in this period. Keep recording every day and billing approved hours promptly.');
  doc.heading('2. Key figures, and what they mean');
  r.kpis.forEach(k => { doc.facts([[k.label, formatKpi(k)]]); doc.paragraph(k.meaning); });
  doc.heading('3. Every leak, by what it costs');
  doc.paragraph('Each leak is worked out from your own bookings, time records, invoices and payments. How measured says exactly how, so every figure can be checked. Money lost or owed comes first; missed opportunity last.');
  r.findings.forEach((f, i) => {
    doc.heading(`3.${i + 1} ${f.title}`);
    doc.facts([['Amount', php(f.amountPhp)], ['Priority', `${KIND[f.kind]} | ${f.severity.toUpperCase()} | ${f.count} item${f.count === 1 ? '' : 's'}`]]);
    if (f.amountPhp <= 0 && f.count === 0) { doc.paragraph('None this period.'); return; }
    doc.paragraph(`Why it matters: ${f.whyItMatters}`); doc.paragraph(`What to do: ${f.whatToDo}`); doc.paragraph(`How measured: ${f.howMeasured}`);
    if (f.records.length) doc.table(['Record', 'Detail', 'Amount'], f.records.map(rec => [rec.label, rec.detail, php(rec.amountPhp)]), [.23, .53, .24]);
  });
  doc.heading('4. Operations context');
  doc.facts([
    ['Fleet units', String(r.master.fleetTotal)],
    ...Object.entries(r.master.fleetByStatus).map(([s, c]) => [label(s), String(c)] as [string, string]),
    ['Units due for maintenance', String(r.master.maintenanceDue)], ['Customers on file (KYC-approved)', `${r.master.customersTotal} (${r.master.customersKycApproved})`], ['Project sites', String(r.master.projectSites)],
  ]);
  doc.heading('Transactions');
  doc.facts([
    ['Bookings created', String(r.ledger.bookings.count)], ...Object.entries(r.ledger.bookings.byStatus).map(([s, c]) => [label(s), String(c)] as [string, string]),
    ['Quotations issued', String(r.ledger.quotations)], ['Truck trips', String(r.ledger.truckTrips)],
    ...Object.entries(r.ledger.invoicesByType).map(([t, a]) => [`Invoiced: ${label(t)}`, php(a)] as [string, string]),
    [`Payments received (${r.ledger.payments.count} records)`, php(r.ledger.payments.paid)], [`Deposit deductions (${r.ledger.depositDeductions.count})`, php(r.ledger.depositDeductions.amount)],
  ]);
  doc.paragraph('Figures cover only this company and period; overdue invoices and machines kept past their end date are as of today. Hours are valued at the hourly rate card in force on the day (8 billable hours per day where a booking has none). Lost: earned but never billed unless someone acts. Cash delayed: billed or billable, not yet collected. Missed opportunity: capacity that earned nothing, not money owed. Truck trips are left out when a customer or equipment filter is set.');
  return doc.finish();
}
