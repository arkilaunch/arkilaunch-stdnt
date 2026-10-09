// Browser-safe: the real PayMongo adapter and its HMAC verification live in apps/api.

export interface CheckoutSession {
  id: string;
  checkoutUrl: string;
}

// No card/bank data is stored. amountPhp is PHP; the adapter converts to centavos at the boundary.
// Only QR Ph is activated on the account. Re-enable channels by extending this list.
export const CHECKOUT_METHODS = ['qrph'] as const;
export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];
// Labels for activated channels; inactive entries never render or validate.
export const CHECKOUT_METHOD_INFO: Record<string, { title: string; description: string }> = {
  qrph: { title: 'QR Ph', description: 'Scan the QR code with any banking or e-wallet app that supports QR Ph.' },
  gcash: { title: 'GCash', description: 'Confirm with GCash on the secure payment page.' },
  paymaya: { title: 'Maya', description: 'Confirm with Maya on the secure payment page.' },
  dob: { title: 'Online banking', description: 'Pay through your bank on the secure payment page.' },
  card: { title: 'Credit or debit card', description: 'Enter card details only on the secure payment page.' },
};

export interface CheckoutOptions {
  label?: string;
  bookingCode?: string;
  methods?: CheckoutMethod[];
  // Net amount routed to the tenant's child account via split_payment.transfer_to; absent = parent account.
  transferTo?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionStatus {
  paid: boolean;
  paymentId?: string;
  amountCentavos?: number;
}

export interface PaymentsPort {
  createCheckoutSession(amountPhp: number, invoiceId: string, options: CheckoutOptions): Promise<CheckoutSession>;
  getCheckoutSession(sessionId: string): Promise<CheckoutSessionStatus>;
  expireCheckoutSession(sessionId: string): Promise<void>;
  refund(paymentId: string, amountPhp: number, reason: RefundReason): Promise<{ id: string }>;
}

export const REFUND_REASONS = ['requested_by_customer', 'duplicate', 'fraudulent', 'others'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export class StubPaymentsAdapter implements PaymentsPort {
  async createCheckoutSession(amountPhp: number, invoiceId: string): Promise<CheckoutSession> {
    return { id: `stub_${invoiceId}`, checkoutUrl: `about:blank?amount=${amountPhp}` };
  }

  async getCheckoutSession(_sessionId: string): Promise<CheckoutSessionStatus> {
    return { paid: false };
  }

  async expireCheckoutSession(_sessionId: string): Promise<void> {}

  async refund(paymentId: string): Promise<{ id: string }> {
    return { id: `stub_ref_${paymentId}` };
  }
}
