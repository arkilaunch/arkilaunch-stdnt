import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { Button } from './button.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { Input } from './input.js';
import { useToast } from './toast.js';

// QA 34: a walk-in paid at the office. Staff record it here (optional OR number); the drawer then offers deploy/dispatch.
export function OfficePaymentButton({
  path,
  what,
  next,
  onPaid,
}: {
  /** `/bookings/:id/mark-paid` or `/truck-requests/:id/mark-paid` */
  path: string;
  what: string;
  next: string;
  onPaid: () => void;
}) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [receiptNo, setReceiptNo] = useState('');
  const pay = useMutation({
    mutationFn: () => apiPost(path, receiptNo.trim() ? { receiptNo: receiptNo.trim() } : {}),
    onSuccess: () => {
      setAsking(false);
      setReceiptNo('');
      onPaid();
      toast.success('Marked paid', next);
    },
    onError: (e) => {
      setAsking(false);
      toast.error('Not marked paid', apiErrorText(e));
    },
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setAsking(true)}>
        Mark as paid (office)
      </Button>
      <ConfirmDialog
        open={asking}
        title="Mark as paid at the office?"
        body={
          <div className="flex flex-col gap-3">
            <p>
              Confirm the customer paid the agreed amount for this {what} in person. It is recorded as cash under your
              name, and counts as their acceptance of the price.
            </p>
            <Input
              label="Official receipt (OR) number"
              hint="Optional. Add it now if the receipt is already written."
              maxLength={40}
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
            />
          </div>
        }
        confirmLabel="Mark as paid"
        tone="approve"
        pending={pay.isPending}
        onConfirm={() => pay.mutate()}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
