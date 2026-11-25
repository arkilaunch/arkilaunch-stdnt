import type { InvoiceDetailResponse } from '@arkilaunch/shared';
import { DocumentPdf } from '../common/document-pdf.js';
import { pdfDate, pdfMoney, type StatementBrand } from './statement-pdf.js';
type Payment = {
  id: string;
  receiptNo: string | null;
  method: string;
  amount: string;
  createdAt: Date;
};
export async function renderInvoicePdf(
  invoice: InvoiceDetailResponse,
  brand: StatementBrand,
): Promise<Uint8Array> {
  const doc = await DocumentPdf.create('Invoice', invoice.id, brand);
  doc.facts([
    ['Booking', invoice.bookingCode ?? '-'],
    ['Client / company', invoice.billTo?.companyName ?? '-'],
    ...(invoice.rentalStatement ? ([
      ['Heavy equipment', invoice.rentalStatement.equipment.join(', ') || '-'],
      ['Job site', invoice.rentalStatement.jobSite],
    ] as [string, string][]) : []),
    ['Customer TIN', invoice.billTo?.tin ?? '-'],
    ['Billing address', invoice.billTo?.billingAddress ?? '-'],
    ['Type', invoice.invoiceType.replace(/_/g, ' ')],
    ['Issued', pdfDate(invoice.createdAt)],
    ['Due', pdfDate(invoice.dueDate)],
    ['Status', invoice.status],
  ]);
  doc.heading('Billing statement');
  const weekly = invoice.rentalStatement?.usageLines ?? [];
  doc.table(
    ['No.', 'Particulars', 'Qty', 'Unit', 'Unit price', 'Amount'],
    (weekly.length ? weekly.map((unit) => ({ description: `${unit.label} (SN ${unit.serialNo})\nPeriod: ${invoice.rentalStatement!.weekStart} - ${invoice.rentalStatement!.weekEnd}`,
      quantity: unit.hours, unit: 'hrs', unitPrice: unit.unitPrice, amount: unit.gross }))
      : invoice.lineItems.map((line) => ({ ...line, unit: invoice.rentalId && ['booking', 'deposit'].includes(invoice.invoiceType) ? 'item' : 'hrs' })))
      .map((line, index) => [String(index + 1), line.description, String(line.quantity), line.unit, pdfMoney(line.unitPrice), pdfMoney(line.amount)]),
    [0.06, 0.42, 0.1, 0.1, 0.16, 0.16],
  );
  if (weekly.length) {
    doc.heading('Deposit applied by machine');
    doc.facts(weekly.map((unit) => [`${unit.label} (SN ${unit.serialNo})`, pdfMoney(unit.depositApplied)]));
  }
  doc.heading('Invoice total');
  doc.facts([['Total charged', pdfMoney(invoice.amount)]]);
  if (invoice.edtrEvidence)
    doc.paragraph(
      `Reconciliation: ${invoice.edtrEvidence.reconciliationId}. Status: ${invoice.edtrEvidence.status}. Source logs: ${invoice.edtrEvidence.sourceEdtrIds.join(', ')}.`,
    );
  return doc.finish();
}
export async function renderReceiptPdf(
  invoice: InvoiceDetailResponse,
  paid: Payment[],
  brand: StatementBrand,
): Promise<Uint8Array> {
  const doc = await DocumentPdf.create('Payment receipt', invoice.id, brand);
  doc.facts([
    ['Invoice', invoice.id],
    ['Booking', invoice.bookingCode ?? '-'],
    ['Received from', invoice.billTo?.companyName ?? '-'],
    ['Billing address', invoice.billTo?.billingAddress ?? '-'],
  ]);
  doc.table(
    ['Receipt / payment reference', 'Date', 'Method', 'Amount'],
    paid.map((p) => [
      p.receiptNo ?? p.id,
      pdfDate(p.createdAt),
      p.method,
      pdfMoney(Number(p.amount)),
    ]),
    [0.37, 0.23, 0.16, 0.24],
  );
  doc.facts([['Total received', pdfMoney(paid.reduce((sum, p) => sum + Number(p.amount), 0))]]);
  doc.paragraph(
    'Acknowledges the successful payments recorded above. Uses the original receipt reference where recorded; this download does not create a new official receipt number.',
  );
  return doc.finish();
}
export async function renderAgreementPdf(
  agreement: {
    termsBody: string;
    termsVersion: string;
    signedName: string;
    signedAt: Date;
    signaturePng: string;
  },
  reference: string,
  brand: StatementBrand,
): Promise<Uint8Array> {
  const doc = await DocumentPdf.create('Signed rental agreement', reference, brand);
  doc.facts([
    ['Terms version', agreement.termsVersion],
    ['Signed by', agreement.signedName],
    [
      'Signed at',
      agreement.signedAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' (Asia/Manila)',
    ],
  ]);
  doc.paragraph(agreement.termsBody);
  doc.reserve(180);
  doc.heading('Electronic signature');
  doc.paragraph(agreement.signedName);
  await doc.signature(agreement.signaturePng);
  return doc.finish();
}
