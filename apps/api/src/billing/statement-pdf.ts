import type { StatementOfAccount } from '@arkilaunch/shared';
import { DocumentPdf } from '../common/document-pdf.js';
export interface StatementBrand {
  name: string;
  address: string;
  contact: string;
  tin: string | null;
  logo?: Uint8Array | null;
  primaryColor?: string | null;
  font?: 'inter' | 'plex' | null;
}
export const pdfMoney = (n: number) =>
  `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pdfDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
export async function renderStatementPdf(
  soa: StatementOfAccount,
  brand: StatementBrand,
): Promise<Uint8Array> {
  const doc = await DocumentPdf.create('Statement of Account', soa.bookingCode ?? '', brand);
  doc.facts([
    ['Bill to', soa.company?.name ?? '-'],
    ['Customer TIN', soa.company?.tin ?? '-'],
    ['Billing address', soa.company?.billingAddress ?? '-'],
    [
      'Rental period',
      `${pdfDate(soa.rentalStart)} - ${soa.rentalEnd ? pdfDate(soa.rentalEnd) : 'open'}`,
    ],
    ['Status', soa.status],
    ['Generated', pdfDate(soa.generatedAt)],
  ]);
  const sum = (key: 'amount' | 'fromDeposit' | 'customerPays' | 'paid' | 'outstanding') =>
    soa.weeks.reduce((n, w) => n + w[key], 0);
  doc.heading('Hours by week');
  doc.paragraph(
    'Hours beyond the deposit are billed weekly and payable by the customer. Amounts below are in PHP.',
  );
  doc.table(
    ['Week', 'Hours', 'Amount', 'From deposit', 'Customer pays', 'Paid', 'Outstanding'],
    [
      ...soa.weeks.map((w) => [
        `${pdfDate(w.weekStart)} - ${pdfDate(w.weekEnd)}`,
        w.hours.toFixed(2),
        pdfMoney(w.amount),
        pdfMoney(w.fromDeposit),
        pdfMoney(w.customerPays),
        pdfMoney(w.paid),
        pdfMoney(w.outstanding),
      ]),
      ...(soa.weeks.length
        ? [
            [
              'TOTAL',
              '',
              pdfMoney(sum('amount')),
              pdfMoney(sum('fromDeposit')),
              pdfMoney(sum('customerPays')),
              pdfMoney(sum('paid')),
              pdfMoney(sum('outstanding')),
            ],
          ]
        : []),
    ],
    [0.23, 0.08, 0.14, 0.14, 0.14, 0.13, 0.14],
  );
  doc.heading('Invoices');
  doc.table(
    ['Type', 'Issued', 'Due', 'Status', 'Amount'],
    soa.invoices.map((i) => [
      i.invoiceType.replace(/_/g, ' '),
      pdfDate(i.createdAt),
      pdfDate(i.dueDate),
      i.status,
      pdfMoney(i.amount),
    ]),
    [0.22, 0.18, 0.18, 0.14, 0.28],
  );
  doc.heading('Payments');
  doc.table(
    ['Method', 'Date', 'Status', 'Amount'],
    soa.payments.map((p) => [p.method, pdfDate(p.createdAt), p.status, pdfMoney(p.amount)]),
  );
  doc.heading('Summary');
  doc.facts([
    ['Deposit required', pdfMoney(soa.deposit.required)],
    ['Deducted from deposit', pdfMoney(soa.deposit.deducted)],
    ['Deposit remaining', pdfMoney(soa.deposit.remaining)],
    ['Total charged', pdfMoney(soa.totals.charged)],
    ['Total paid', pdfMoney(soa.totals.paid)],
    ['Weekly billings outstanding', pdfMoney(sum('outstanding'))],
    ['Unbilled hours to date', pdfMoney(soa.totals.unbilled)],
    ['BALANCE DUE', pdfMoney(soa.totals.balanceDue)],
  ]);
  return doc.finish();
}
