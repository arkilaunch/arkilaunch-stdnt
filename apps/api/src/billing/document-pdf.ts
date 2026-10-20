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
    ['Bill to', invoice.billTo?.companyName ?? '-'],
    ['Customer TIN', invoice.billTo?.tin ?? '-'],
    ['Billing address', invoice.billTo?.billingAddress ?? '-'],
    ['Type', invoice.invoiceType.replace(/_/g, ' ')],
    ['Issued', pdfDate(invoice.createdAt)],
    ['Due', pdfDate(invoice.dueDate)],
    ['Status', invoice.status],
  ]);
  doc.heading('Charges');
  doc.table(
    ['Description', 'Quantity', 'Unit price', 'Amount'],
    invoice.lineItems.map((l) => [
      l.description,
      String(l.quantity),
      pdfMoney(l.unitPrice),
      pdfMoney(l.amount),
    ]),
    [0.49, 0.11, 0.2, 0.2],
  );
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
