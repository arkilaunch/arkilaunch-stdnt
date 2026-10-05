import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { LeakageKpi, LeakageReport } from '@arkilaunch/shared';
import type { StatementBrand } from '../billing/statement-pdf.js';
import { isPng } from '../common/tenant-brand.js';

const W = 612;
const H = 792;
const M = 48;
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.4, 0.4, 0.4);

// Same WinAnsi rules as statement-pdf: no peso sign, ASCII only.
const php = (n: number) => `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  });
const ascii = (s: string) => s.replace(/[–—]/g, '-').replace(/[·•]/g, '|').replace(/[^\x20-\x7E]/g, '');
const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const NO_DATA = 'No data in period';
export function formatKpi(x: LeakageKpi): string {
  if (x.value === null) return NO_DATA;
  return x.unit === 'php' ? php(x.value) : x.unit === 'pct' ? `${x.value.toFixed(1)}%` : `${x.value.toFixed(1)} days`;
}
const KIND: Record<string, string> = { lost: 'Lost unless acted on', delayed: 'Cash delayed', opportunity: 'Missed opportunity' };
const SEVERITY_COLOR = { high: rgb(0.77, 0.17, 0.11), medium: rgb(0.85, 0.38, 0.04), low: MUTED } as const;

// Revenue Leakage Report (QA 35): what is at risk in pesos, what to do first, each leak explained, then context.
export async function renderLeakageReportPdf(r: LeakageReport, brand: StatementBrand): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Revenue Leakage Report ${r.period.from} to ${r.period.to}`);
  pdf.setCreator('ArkiLaunch');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const write = (x: number, s: string, size = 9, f: PDFFont = font, color = INK) =>
    page.drawText(ascii(s), { x, y, size, font: f, color });
  const right = (x: number, s: string, size = 9, f: PDFFont = font, color = INK) =>
    page.drawText(ascii(s), { x: x - f.widthOfTextAtSize(ascii(s), size), y, size, font: f, color });
  const rule = (weight = 0.5) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: weight, color: MUTED });
  const need = (h: number) => {
    if (y - h > M + 20) return;
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  // Greedy word wrap at a fixed width.
  const wrap = (s: string, width: number, size: number, f: PDFFont = font) => {
    const lines: string[] = [];
    let line = '';
    for (const word of ascii(s).split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const heading = (s: string) => {
    need(40);
    y -= 6;
    write(M, s, 11, bold);
    y -= 6;
    rule(1);
    y -= 14;
  };
  const rows = (pairs: [string, string][], strongLast = false) => {
    pairs.forEach(([k, v], i) => {
      need(14);
      const strong = strongLast && i === pairs.length - 1;
      write(M, k, 9, strong ? bold : font);
      right(W - M, v, 9, strong ? bold : font);
      y -= 13;
    });
    y -= 6;
  };

  // Letterhead: tenant icon on the left, name and details beside it.
  const logo = brand.logo ? await (isPng(brand.logo) ? pdf.embedPng(brand.logo) : pdf.embedJpg(brand.logo)).catch(() => null) : null;
  const top = y;
  let tx = M;
  if (logo) {
    const LOGO = 40;
    const s = logo.scaleToFit(LOGO, LOGO);
    page.drawImage(logo, { x: M, y: top + 12 - s.height, width: s.width, height: s.height });
    tx = M + s.width + 12;
  }
  page.drawText(ascii(brand.name.toUpperCase()), { x: tx, y, size: 14, font: bold, color: INK });
  y -= 14;
  for (const line of [brand.address, brand.contact, brand.tin ? `TIN ${brand.tin}` : '']) {
    if (!line) continue;
    page.drawText(ascii(line), { x: tx, y, size: 8, font, color: MUTED });
    y -= 11;
  }
  if (logo) y = Math.min(y, top - 32);
  y -= 6;
  rule(1);
  y -= 22;
  write(M, 'REVENUE LEAKAGE REPORT', 13, bold);
  y -= 14;
  write(M, 'Where money is leaking, what it costs, and what to do about it', 9, font, MUTED);
  y -= 18;
  for (const [k, v] of [
    ['Period', `${day(r.period.from)} - ${day(r.period.to)}`],
    ['Customer', r.filters.customer ?? 'All customers'],
    ['Equipment type', r.filters.equipmentType ?? 'All types'],
    ['Generated', `${new Date(r.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Manila)`],
  ] as const) {
    write(M, k, 8, bold, MUTED);
    write(M + 100, v, 9);
    y -= 13;
  }
  y -= 8;


  const para = (s: string, size = 8.5, color = INK, indent = 0, f: PDFFont = font) => {
    for (const line of wrap(s, W - 2 * M - indent, size, f)) {
      need(12);
      write(M + indent, line, size, f, color);
      y -= size + 3;
    }
  };

  heading('1. What is at risk');
  need(60);
  y -= 10;
  write(M, php(r.summary.atRisk.total), 20, bold);
  y -= 16;
  para(`at risk in this period. ${php(r.summary.atRisk.lost)} is earned but will be lost unless someone acts, ${php(r.summary.atRisk.delayed)} is owed but not yet collected, and ${php(r.summary.atRisk.opportunity)} is capacity that earned nothing.`, 9, MUTED);
  y -= 6;
  rows([
    ['Invoiced this period', php(r.summary.invoiced)],
    ['Collected', php(r.summary.collected)],
    ['Billed from reconciled time records', php(r.summary.verifiedRevenue)],
  ]);
  if (r.summary.topActions.length) {
    write(M, 'Do these first', 10, bold);
    y -= 14;
    r.summary.topActions.forEach((a, i) => {
      need(30);
      write(M, `${i + 1}. ${a.title}`, 9, bold);
      right(W - M, php(a.amountPhp), 9, bold);
      y -= 12;
      para(a.whatToDo, 8.5, INK, 12);
      y -= 4;
    });
  } else {
    para('No leaks found in this period. Keep recording every day and billing approved hours promptly.', 9);
  }

  heading('2. Key figures, and what they mean');
  for (const k of r.kpis) {
    need(30);
    write(M, k.label, 9, bold);
    right(W - M, formatKpi(k), 9, bold, k.value === null ? MUTED : INK);
    y -= 12;
    para(k.meaning, 8, MUTED, 12);
    y -= 4;
  }

  heading('3. Every leak, by what it costs');
  para('Each leak is worked out from your own bookings, time records, invoices and payments. "How measured" says exactly how, so every figure can be checked. Money lost or owed comes first; missed opportunity last.', 8, MUTED);
  y -= 6;
  r.findings.forEach((f, i) => {
    need(70);
    write(M, `3.${i + 1}  ${f.title}`, 10, bold);
    right(W - M, php(f.amountPhp), 10, bold, f.amountPhp > 0 ? SEVERITY_COLOR[f.severity] : MUTED);
    y -= 12;
    write(M + 12, `${KIND[f.kind]}  |  ${f.severity.toUpperCase()} priority  |  ${f.count} item${f.count === 1 ? '' : 's'}`, 7.5, font, MUTED);
    y -= 12;
    if (f.amountPhp <= 0 && f.count === 0) {
      para('None this period.', 8.5, MUTED, 12);
      y -= 6;
      return;
    }
    write(M + 12, 'Why it matters', 8, bold);
    y -= 11;
    para(f.whyItMatters, 8.5, INK, 12);
    write(M + 12, 'What to do', 8, bold);
    y -= 11;
    para(f.whatToDo, 8.5, INK, 12);
    write(M + 12, 'How measured', 8, bold, MUTED);
    y -= 11;
    para(f.howMeasured, 7.5, MUTED, 12);
    for (const rec of f.records) {
      need(12);
      const text = wrap(`${rec.label}: ${rec.detail}`, W - 2 * M - 110, 7.5)[0] ?? '';
      write(M + 18, text, 7.5);
      right(W - M, php(rec.amountPhp), 7.5);
      y -= 10;
    }
    y -= 8;
  });

  heading('4. Operations context');
  rows([
    ['Fleet units', String(r.master.fleetTotal)],
    ...Object.entries(r.master.fleetByStatus).map(([s, c]) => [`   ${label(s)}`, String(c)] as [string, string]),
    ['Units due for maintenance', String(r.master.maintenanceDue)],
    ['Customers on file (KYC-approved)', `${r.master.customersTotal} (${r.master.customersKycApproved})`],
    ['Project sites', String(r.master.projectSites)],
  ]);

  write(M, 'Transactions', 10, bold);
  y -= 14;
  rows([
    ['Bookings created', String(r.ledger.bookings.count)],
    ...Object.entries(r.ledger.bookings.byStatus).map(([s, c]) => [`   ${label(s)}`, String(c)] as [string, string]),
    ['Quotations issued', String(r.ledger.quotations)],
    ['Truck trips', String(r.ledger.truckTrips)],
  ]);
  const types = Object.entries(r.ledger.invoicesByType);
  rows([
    ...(types.length ? types.map(([t, a]) => [`Invoiced: ${label(t)}`, php(a)] as [string, string]) : [['Invoices', NO_DATA] as [string, string]]),
    [`Payments received (${r.ledger.payments.count} records)`, php(r.ledger.payments.paid)],
    [`Deposit deductions (${r.ledger.depositDeductions.count})`, php(r.ledger.depositDeductions.amount)],
  ]);

  need(40);
  for (const line of wrap(
    'Figures cover only this company and period; overdue invoices and machines kept past their end date are as of today. Hours are valued at the hourly rate card in force on the day (8 billable hours per day where a booking has none). Lost: earned but never billed unless someone acts. Cash delayed: billed or billable, not yet collected. Missed opportunity: capacity that earned nothing, not money owed. Truck trips are left out when a customer or equipment filter is set.',
    W - 2 * M,
    7,
  )) {
    write(M, line, 7, font, MUTED);
    y -= 9;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const footer = ascii(`Revenue Leakage Report  |  ${r.period.from} to ${r.period.to}  |  Page ${i + 1} of ${pages.length}`);
    p.drawText(footer, { x: M, y: M - 18, size: 7, font, color: MUTED });
  });
  return pdf.save();
}
