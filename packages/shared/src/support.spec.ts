import { describe, expect, it } from 'vitest';
import { CheckoutRequestSchema } from './payments.js';
import { TicketCreateSchema, TicketPatchSchema } from './support.js';

describe('checkout methods', () => {
  it('accepts only QR Ph online and preserves cash', () => {
    expect(CheckoutRequestSchema.safeParse({ method: 'qrph' }).success).toBe(true);
    expect(CheckoutRequestSchema.safeParse({ cash: true }).success).toBe(true);
    for (const method of ['gcash', 'paymaya', 'dob', 'card']) expect(CheckoutRequestSchema.safeParse({ method }).success).toBe(false);
  });
});
describe('support boundaries', () => {
  const body = { category: 'payment', subject: 'A question', message: 'Please help' };
  it('rejects empty or long text and client-supplied staff fields', () => {
    for (const override of [{ subject: ' ' }, { message: '' }, { subject: 'x'.repeat(121) }, { message: 'x'.repeat(4001) }, { priority: 'high' }, { tenantId: 'arbitrary' }, { bookingId: 'invalid' }]) {
      expect(TicketCreateSchema.safeParse({ ...body, ...override }).success).toBe(false);
    }
  });
  it('accepts only defined status, priority and assignee changes', () => {
    expect(TicketPatchSchema.safeParse({}).success).toBe(false);
    expect(TicketPatchSchema.safeParse({ status: 'in_progress', assignedTo: null }).success).toBe(true);
    expect(TicketPatchSchema.safeParse({ subject: 'changed' }).success).toBe(false);
  });
});
