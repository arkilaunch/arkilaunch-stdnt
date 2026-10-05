import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDetailResponse } from '@arkilaunch/shared';
import { apiErrorText, apiPost } from '../lib/api-client.js';
import { tierQueries, usersQueries } from '../lib/queries.js';
import { formatStatus } from '../lib/format.js';
import { Alert } from './alert.js';
import { Button } from './button.js';
import { useToast } from './toast.js';

// "Gold tier · up to 5% discount"; an overdue balance shuts negotiation off (UC 005).
export function TierNote({ customerId, audience }: { customerId: string; audience: 'staff' | 'customer' }) {
  const tier = useQuery({ ...tierQueries.customer(customerId), enabled: Boolean(customerId) });
  if (!tier.data) return null;
  const { tier: name, capPct, hasOverdue } = tier.data;
  if (hasOverdue) {
    return (
      <Alert type="warning" header="Negotiation unavailable">
        {audience === 'customer'
          ? 'Your account has an overdue balance. Settle it to send price offers again.'
          : 'This customer has an overdue balance: their cap is 0%, so any discount needs the Owner.'}
      </Alert>
    );
  }
  return (
    <p className="text-sm text-text-muted">
      <span className="font-semibold text-text">{formatStatus(name)} tier</span> ·{' '}
      {capPct > 0
        ? `up to ${capPct}% discount${audience === 'staff' ? ' applies at once; more needs the Owner' : ''}`
        : audience === 'staff'
          ? 'no discount without Owner approval'
          : 'discounts are reviewed by the owner'}
    </p>
  );
}

// Staff drawer: an over-cap discount waits here for the Owner.
export function CapReview({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useQuery(usersQueries.me());
  const [busy, setBusy] = useState<boolean | null>(null);
  const decide = useMutation({
    mutationFn: (approved: boolean) => apiPost(`/quotes/${booking.quotation?.id}/cap-decision`, { approved }),
    onMutate: (approved) => setBusy(approved),
    onSettled: () => setBusy(null),
    onSuccess: async (_data, approved) => {
      await queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      toast.success(approved ? 'Discount approved' : 'Discount rejected', approved ? 'The quote was sent to the customer.' : 'Staff must revise the quote.');
    },
    onError: (err) => toast.error('Could not record the decision', apiErrorText(err)),
  });
  const status = booking.quotation?.capStatus;
  if (status !== 'pending_owner' && status !== 'owner_rejected') return null;
  if (status === 'owner_rejected') {
    return <Alert type="error" header="Discount rejected by the Owner">Revise the quote within the customer's tier cap.</Alert>;
  }
  const isOwner = me.data?.role === 'owner';
  return (
    <Alert type="warning" header="Discount above the tier cap">
      <div className="flex flex-col gap-2">
        <TierNote customerId={booking.customerId} audience="staff" />
        {isOwner ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="approve" loading={busy === true} disabled={busy !== null} onClick={() => decide.mutate(true)}>
              Approve discount
            </Button>
            <Button variant="secondary" loading={busy === false} disabled={busy !== null} onClick={() => decide.mutate(false)}>
              Reject
            </Button>
          </div>
        ) : (
          <p className="text-sm">Waiting for the Owner to approve or reject it.</p>
        )}
      </div>
    </Alert>
  );
}
