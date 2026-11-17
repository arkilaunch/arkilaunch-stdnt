import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { InvoiceDetailResponse } from '@arkilaunch/shared';
import { renderAgreementPdf, renderInvoicePdf, renderReceiptPdf } from './document-pdf.js';
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const at = new Date('2026-10-20T09:00:00+08:00');
const brand = {
  name: 'Peñafrancia Equipment • José ₱',
  address: 'Quezon City',
  contact: 'office@example.test',
  tin: null,
};
const invoice = (count = 1): InvoiceDetailResponse => ({
  id: '00000000-0000-4000-8000-000000000001',
  rentalId: '00000000-0000-4000-8000-000000000002',
  truckRequestId: null,
  bookingCode: 'EQR-PDF-QA',
  invoiceType: 'damage',
  amount: count * 1250.25,
  status: 'issued',
  createdAt: at,
  dueDate: at,
  billTo: {
    companyName: 'José Peñafrancia ' + 'Long customer company name '.repeat(12),
    tin: '123-456',
    billingAddress: 'Long address '.repeat(25),
  },
  lineItems: Array.from({ length: count }, (_, i) => ({
    id: `line-${i}`,
    description:
      `Repair ${i}: ` + 'Documented replacement and agreed estimate '.repeat(12) + 'A'.repeat(150),
    quantity: 1,
    unitPrice: 1250.25,
    amount: 1250.25,
  })),
  receiptNo: null,
  edtrEvidence: null,
  auditTrail: [],
});

describe('billing document PDFs', () => {
  it('preserves invoice metadata and paginates long Unicode rows with either font', async () => {
    const data = invoice(12);
    const original = structuredClone(data);
    for (const font of ['inter', 'plex'] as const) {
      const bytes = await renderInvoicePdf(data, { ...brand, font, primaryColor: '#123456' });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getTitle()).toBe(`Invoice ${data.id}`);
      expect(doc.getPageCount()).toBeGreaterThan(2);
      expect(
        doc.getPages().every((page) => page.getWidth() === 612 && page.getHeight() === 792),
      ).toBe(true);
    }
    expect(data).toEqual(original);
  });

  it('renders missing and corrupt branding and a successful payment receipt without changing amounts', async () => {
    const data = invoice();
    const payments = [
      { id: 'payment-qa', receiptNo: 'OR-QA-42', method: 'cash', amount: '1250.25', createdAt: at },
    ];
    const original = structuredClone(payments);
    for (const logo of [undefined, Uint8Array.from([137, 80, 78, 71])]) {
      const bytes = await renderReceiptPdf(data, payments, {
        ...brand,
        ...(logo ? { logo } : {}),
        primaryColor: 'invalid',
      });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getTitle()).toBe(`Payment receipt ${data.id}`);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    }
    expect(payments).toEqual(original);
  });

  it('renders a long signed terms snapshot and embedded signature with proportional logo', async () => {
    const agreement = {
      termsBody:
        'The signed snapshot excludes normal wear.\n\n' +
        'Signed clause: customer liability requires evidence and review. '.repeat(200),
      termsVersion: 'signed-v1',
      signedName: 'José Peñafrancia',
      signedAt: at,
      signaturePng: TINY_PNG,
    };
    const before = structuredClone(agreement);
    const bytes = await renderAgreementPdf(agreement, 'EQR-PDF-QA', {
      ...brand,
      logo: Buffer.from(TINY_PNG.split(',')[1]!, 'base64'),
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe('Signed rental agreement EQR-PDF-QA');
    expect(doc.getPageCount()).toBeGreaterThan(2);
    expect(Buffer.from(bytes).toString('latin1')).toContain('/Subtype /Image');
    expect(agreement).toEqual(before);
  });
});
