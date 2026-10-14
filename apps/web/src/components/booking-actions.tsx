import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDetailResponse, ChangeRequestResolve, RescheduleSuggestion } from '@arkilaunch/shared';
import { BookingReturnRequestSchema, ChangeRequestResolveSchema, localPhMobile } from '@arkilaunch/shared';
import { bookingsQueries, sitesQueries } from '../lib/queries.js';
import { ApiError, apiErrorText, apiGet, apiPatch, apiPost, payloadField } from '../lib/api-client.js';
import { formatDate, formatDateTime, formatPeso, formatStatus } from '../lib/format.js';
import { Container } from './container.js';
import { Alert } from './alert.js';
import { Button, buttonClass } from './button.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { StatusBadge } from './status-badge.js';
import { SiteProofAdmin } from './site-proof.js';
import { SiteEquipmentWeather } from './equipment-weather.js';
import { EdtrSheetCard } from './edtr-sheet-card.js';
import { OfficePaymentButton } from './office-payment.js';
import { useToast } from './toast.js';
import { MessengerLinks, phoneHref } from './messenger-links.js';

export function PendingRequests({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [charge, setCharge] = useState('');
  const [chargeReason, setChargeReason] = useState('');
  const [chargeError, setChargeError] = useState<string>();
  const [reasonError, setReasonError] = useState<string>();
  const [serverNeedsReason, setServerNeedsReason] = useState(false);
  const resolve = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeRequestResolve }) =>
      apiPatch(`/bookings/${booking.id}/change-requests/${id}`, body),
    onSuccess: async (_data, { body: { decision } }) => {
      setAsk(null);
      await queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      toast.success(decision === 'approved' ? 'Request approved' : 'Request declined', 'The customer has been notified.');
    },
    onError: (err) => {
      if (payloadField(err, 'error') === 'extension_charge_required') {
        setChargeError('Enter the extra charge.');
        return;
      }
      if (payloadField(err, 'error') === 'charge_reason_required') {
        setServerNeedsReason(true);
        setReasonError('Explain why the charge differs from the suggestion.');
        return;
      }
      toast.error('Could not resolve the request', apiErrorText(err));
    },
  });
  const [ask, setAsk] = useState<{ request: BookingDetailResponse['changeRequests'][number]; decision: 'approved' | 'rejected' } | null>(null);
  const needsReason = serverNeedsReason || (ask?.request.kind === 'extend' && Number(charge) !== ask.request.suggestedChargePhp);
  function openRequest(request: BookingDetailResponse['changeRequests'][number], decision: 'approved' | 'rejected') {
    setCharge(request.suggestedChargePhp === null ? '' : String(request.suggestedChargePhp));
    setChargeReason('');
    setChargeError(undefined);
    setReasonError(undefined);
    setServerNeedsReason(false);
    setAsk({ request, decision });
  }

  return (
    <Container header={{ title: 'Change requests' }}>
      <div className="flex flex-col gap-3">
      {booking.changeRequests.length === 0 && <p className="text-sm text-text-muted">None.</p>}
      {booking.changeRequests.map((request) => (
        <div key={request.id} className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
          <p className="text-sm text-text">
            {request.kind === 'extend'
              ? `Extend ${booking.items.find((item) => item.id === request.assignmentId)?.equipmentName ?? 'all machines'} to ${formatDate(request.requestedEnd)}`
              : 'Cancel booking'}
            <span className="text-text-muted"> &middot; {formatStatus(request.status)}</span>
          </p>
          {request.reason && <p className="text-sm text-text-muted">{request.reason}</p>}
          {request.status === 'pending' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="approve" disabled={resolve.isPending} onClick={() => openRequest(request, 'approved')}>
                Approve
              </Button>
              <Button variant="secondary" disabled={resolve.isPending} onClick={() => openRequest(request, 'rejected')}>
                Decline
              </Button>
            </div>
          )}
          {request.kind === 'cancel' && request.status === 'pending' && booking.status === 'confirmed' && (
            <p className="text-xs text-text-muted">This booking is paid: issue any refund in the PayMongo dashboard.</p>
          )}
        </div>
      ))}
      <ConfirmDialog
        open={ask !== null}
        tone={ask?.decision === 'approved' ? 'approve' : 'danger'}
        title={
          ask?.decision === 'approved'
            ? ask.request.kind === 'extend'
              ? 'Approve this extension?'
              : 'Approve this cancellation?'
            : 'Decline this request?'
        }
        body={
          ask?.decision === 'approved'
            ? ask.request.kind === 'extend'
              ? <div className="flex flex-col gap-4">
                  <p>{booking.items.find((item) => item.id === ask.request.assignmentId)?.equipmentName ?? 'Every machine'} will run to {formatDate(ask.request.requestedEnd)}; other machines keep their dates. The customer is notified.</p>
                  <Input label="Extra charge (PHP)" type="number" numeric min={0} step="0.01" required value={charge}
                    hint={ask.request.suggestedChargePhp === null ? 'No suggested charge is available. Enter an amount.' : `Suggested: ${formatPeso(ask.request.suggestedChargePhp)}`}
                    error={chargeError} onChange={(e) => { setCharge(e.target.value); setChargeError(undefined); }} />
                  {(needsReason || reasonError) && <Input label="Reason for change" required maxLength={500} value={chargeReason} error={reasonError}
                    onChange={(e) => { setChargeReason(e.target.value); setReasonError(undefined); }} />}
                </div>
              : 'The booking is cancelled for good. The customer is notified.'
            : 'The booking stays as it is. The customer is notified that you declined.'
        }
        confirmLabel={ask?.decision === 'approved' ? 'Approve' : 'Decline'}
        pending={resolve.isPending}
        onConfirm={() => {
          if (!ask) return;
          const extension = ask.decision === 'approved' && ask.request.kind === 'extend';
          const body = ChangeRequestResolveSchema.safeParse({ decision: ask.decision,
            ...(extension ? { chargePhp: charge.trim() ? Number(charge) : NaN } : {}),
            ...(extension && chargeReason.trim() ? { chargeReason: chargeReason.trim() } : {}),
          });
          if (!body.success) {
            setChargeError('Enter a non-negative amount with at most two decimal places.');
            return;
          }
          if (extension && needsReason && !chargeReason.trim()) {
            setReasonError('Explain why the charge differs from the suggestion.');
            return;
          }
          resolve.mutate({ id: ask.request.id, body: body.data });
        }}
        onCancel={() => setAsk(null)}
      />
      </div>
    </Container>
  );
}

function RescheduleCard({ booking }: { booking: BookingDetailResponse }) {
  const bookingId = booking.id;
  const nameOf = (id: string) => booking.items.find((i) => i.equipmentId === id)?.equipmentName ?? 'This machine';
  const suggest = useMutation({
    mutationFn: () => apiGet<RescheduleSuggestion>(`/bookings/${bookingId}/reschedule-suggestion`),
  });
  return (
    <Container header={{ title: 'Reschedule' }}>
      <div className="flex flex-col gap-3 text-sm">
      <div>
        <Button variant="secondary" loading={suggest.isPending} onClick={() => suggest.mutate()}>
          Suggest a new slot
        </Button>
      </div>
      {suggest.isError && <Alert type="error">{apiErrorText(suggest.error)}</Alert>}
      {suggest.data?.items.map((item) => (
        <div key={item.equipmentId} className="flex flex-col gap-1">
          <p className="text-text">
            {nameOf(item.equipmentId)}:{' '}
            {item.sameUnit
              ? `${formatDateTime(item.sameUnit.start)} - ${formatDateTime(item.sameUnit.end)}`
              : 'no free window within 60 days'}
          </p>
          <p className="text-text-muted">
            {item.alternatives.length
              ? `${item.alternatives.length} other free ${item.alternatives.length === 1 ? 'unit' : 'units'} of this type`
              : 'No other free unit of this type'}
          </p>
        </div>
      ))}
      </div>
    </Container>
  );
}

function CallCard({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const confirm = useMutation({
    mutationFn: () => apiPost(`/bookings/${booking.id}/call-confirmed`, {}),
    onSuccess: () => {
      setAsking(false);
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey });
      toast.success('Confirmed by phone', 'The customer can now pay.');
    },
    onError: (e) => toast.error('Not saved', apiErrorText(e)),
  });
  return (
    <Container header={{ title: 'Phone confirmation' }}>
      <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        {booking.callConfirmedAt
          ? `Confirmed ${formatDate(booking.callConfirmedAt)}.`
          : booking.callRequestedAt
            ? 'The customer asked for a call.'
            : 'Call the customer before they pay.'}
      </p>
      {!booking.callConfirmedAt && booking.status !== 'cancelled' && (
        <Button variant="secondary" loading={confirm.isPending} onClick={() => setAsking(true)}>
          Confirmed by phone
        </Button>
      )}
      <ConfirmDialog
        open={asking}
        tone="approve"
        title="Mark as confirmed by phone?"
        body={<p>Only once you have spoken to the customer: it opens checkout for this booking.</p>}
        confirmLabel="Yes, we spoke"
        pending={confirm.isPending}
        onConfirm={() => confirm.mutate()}
        onCancel={() => setAsking(false)}
      />
      </div>
    </Container>
  );
}

function HoldCard({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const extend = useMutation({
    mutationFn: () => apiPatch<{ holdExpiresAt: string }>(`/bookings/${booking.id}/hold`, {}),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Hold extended', `The dates stay held until ${formatDateTime(data.holdExpiresAt)}.`);
    },
    onError: (e) => toast.error('Hold not extended', apiErrorText(e)),
  });
  if (booking.status !== 'pending' || !booking.holdExpiresAt) return null;
  const lapsed = new Date(booking.holdExpiresAt) <= new Date();
  return (
    <Container header={{ title: 'Date hold' }}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          {lapsed
            ? `The hold lapsed ${formatDateTime(booking.holdExpiresAt)}: other customers can book these dates. It is cancelled within the hour unless extended or paid.`
            : `Unpaid, so the dates are held until ${formatDateTime(booking.holdExpiresAt)}. Paying locks them.`}
        </p>
        <Button variant="secondary" loading={extend.isPending} onClick={() => extend.mutate()}>
          Extend hold
        </Button>
      </div>
    </Container>
  );
}

const PAID_OR_CLOSED = ['confirmed', 'active', 'completed', 'cancelled'];

function OfficePaymentCard({ booking }: { booking: BookingDetailResponse }) {
  const queryClient = useQueryClient();
  if (PAID_OR_CLOSED.includes(booking.status)) return null;
  return (
    <Container header={{ title: 'Payment' }}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">Paid at the office? Record it here, then deploy.</p>
        <OfficePaymentButton
          path={`/bookings/${booking.id}/mark-paid`}
          what="booking"
          next="Deploy the machines once they are on site."
          onPaid={() => {
            void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey });
            void queryClient.invalidateQueries({ queryKey: ['bookings'] });
          }}
        />
      </div>
    </Container>
  );
}

export function DeliveryCard({ booking }: { booking: BookingDetailResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [operatorName, setOperatorName] = useState('');
  const [timekeeperUserId, setTimekeeperUserId] = useState('');
  const [units, setUnits] = useState<Record<string, { conditionNotes: string; needsRepair: boolean }>>({});
  const [incomplete, setIncomplete] = useState(false);
  const [confirmIncompleteLogs, setConfirmIncompleteLogs] = useState(false);
  const [reason, setReason] = useState('');
  const [returnError, setReturnError] = useState<string>();
  const activeUnits = booking.items.filter((item) => item.status === 'active');
  const move = useMutation({
    mutationFn: (step: 'deliver' | 'return') =>
      apiPost(
        `/bookings/${booking.id}/${step}`,
        step === 'deliver'
          ? {
              ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
              ...(timekeeperUserId ? { timekeeperUserId } : {}),
            }
          : BookingReturnRequestSchema.parse({
              units: activeUnits.map((item) => ({ assignmentId: item.id, ...units[item.id] })),
              ...(incomplete ? { confirmIncompleteLogs, reason } : {}),
            }),
      ),
    onSuccess: (_data, step) => {
      setAsking(false);
      void queryClient.invalidateQueries({ queryKey: bookingsQueries.detail(booking.id).queryKey });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success(step === 'deliver' ? 'Deployed' : 'Marked returned');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && e.message === 'field_logs_incomplete') {
        setIncomplete(true);
        setConfirmIncompleteLogs(false);
        setReturnError(undefined);
        return;
      }
      toast.error('Not saved', apiErrorText(e));
    },
  });
  const [asking, setAsking] = useState(false);
  const deliverable = booking.status === 'confirmed';
  const hub = useQuery({ ...sitesQueries.hub(booking.projectSiteId), enabled: deliverable && asking });
  const timekeepers = [...(hub.data?.personnel.timekeepers ?? []), ...(hub.data?.personnel.availableTimekeepers ?? [])];
  if (booking.status !== 'confirmed' && booking.status !== 'active') return null;
  const deliver = booking.status === 'confirmed';
  return (
    <Container header={{ title: deliver ? 'Deploy' : 'Delivery' }}>
      <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        {deliver ? 'Paid. Deploy once the machines are on site.' : 'On site. Mark returned once every machine is back.'}
      </p>
      <Button variant="primary" onClick={() => {
        setUnits({}); setIncomplete(false); setConfirmIncompleteLogs(false); setReason('');
        setReturnError(undefined); setAsking(true);
      }}>
        {deliver ? 'Deploy now' : 'Mark returned'}
      </Button>
      <ConfirmDialog
        open={asking}
        title={deliver ? 'Deploy this booking?' : 'Mark this booking returned?'}
        body={
          deliver ? (
            <div className="flex flex-col gap-4">
              <p>Only once every machine is on site: this starts the rental on site and opens the field sheet.</p>
              <Input
                label="Operator name"
                hint="Optional. Who operates the machines on site."
                maxLength={120}
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
              />
              <Select
                label="Timekeeper"
                hint="Optional. Assigned to this site so they can submit the field sheets."
                value={timekeeperUserId}
                onChange={(e) => setTimekeeperUserId(e.target.value)}
              >
                <option value="">None</option>
                {timekeepers.map((t) => (
                  <option key={t.userId} value={t.userId}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p>Only once every machine is back: this closes the booking.</p>
              {activeUnits.map((item) => (
                <fieldset key={item.id} className="flex min-w-0 flex-col gap-2 border-t border-border pt-3">
                  <legend className="text-sm font-semibold">{item.equipmentName ?? 'Machine'}</legend>
                  <label htmlFor={`return-notes-${item.id}`} className="text-sm font-medium">Condition notes</label>
                  <textarea id={`return-notes-${item.id}`} maxLength={2000} rows={3}
                    className="w-full rounded-input border border-border bg-surface px-4 py-2.5 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
                    value={units[item.id]?.conditionNotes ?? ''}
                    onChange={(e) => setUnits((current) => ({ ...current, [item.id]: {
                      conditionNotes: e.target.value, needsRepair: current[item.id]?.needsRepair ?? false,
                    } }))} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={units[item.id]?.needsRepair ?? false}
                      onChange={(e) => setUnits((current) => ({ ...current, [item.id]: {
                        conditionNotes: current[item.id]?.conditionNotes ?? '', needsRepair: e.target.checked,
                      } }))} />
                    Needs repair (mark unavailable)
                  </label>
                </fieldset>
              ))}
              {incomplete && <div className="flex flex-col gap-3">
                <Alert type="warning">Field logs are incomplete. Return anyway only once every machine is back, and record why the logs are still missing.</Alert>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={confirmIncompleteLogs}
                    aria-describedby={returnError ? `return-reason-${booking.id}-error` : undefined}
                    onChange={(e) => { setConfirmIncompleteLogs(e.target.checked); setReturnError(undefined); }} />
                  Confirm return with incomplete field logs
                </label>
                <Input label="Reason for returning with incomplete logs" required maxLength={500} value={reason}
                  error={returnError} id={`return-reason-${booking.id}`}
                  onChange={(e) => { setReason(e.target.value); setReturnError(undefined); }} />
              </div>}
            </div>
          )
        }
        confirmLabel={deliver ? 'Deploy now' : 'Mark returned'}
        pending={move.isPending}
        onConfirm={() => {
          if (!deliver && incomplete && (!confirmIncompleteLogs || reason.trim().length < 3)) {
            setReturnError('Confirm the return and enter a reason of at least 3 characters.');
            return;
          }
          move.mutate(deliver ? 'deliver' : 'return');
        }}
        onCancel={() => setAsking(false)}
      />
      </div>
    </Container>
  );
}

export function SiteRepContact({ name, mobile }: { name: string | null; mobile?: string | null | undefined }) {
  return (
    <>
      {name}
      {mobile && (
        <>
          {name ? ' · ' : ''}
          <a href={phoneHref(mobile)} className="underline">
            +63 {localPhMobile(mobile)}
          </a>
          <MessengerLinks phone={mobile} />
        </>
      )}
    </>
  );
}

export function BookingSide({ booking }: { booking: BookingDetailResponse }) {
  const quote = booking.quotation;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CallCard booking={booking} />
      <HoldCard booking={booking} />
      <OfficePaymentCard booking={booking} />
      <Container header={{ title: 'Quote' }}>
        <div className="flex flex-col gap-3">
        {quote ? (
          <p className="text-sm text-text">
            Revision {quote.revision} &middot; {formatStatus(quote.status)} &middot;{' '}
            <span className="font-mono">{formatPeso(quote.totalPhp)}</span>
          </p>
        ) : (
          <p className="text-sm text-text-muted">Not quoted yet.</p>
        )}
        {quote && quote.status === 'approved' && !quote.inNegotiation && (
          <p className="text-sm text-text-muted">Priced from the price book and sent. You can revise it once the customer negotiates.</p>
        )}
        {booking.status !== 'cancelled' && (!quote || quote.inNegotiation) && (
          <Link to="/app/quotes" search={{ bookingId: booking.id }} className={buttonClass('primary')}>{quote ? 'Revise quote' : 'Quote this booking'}</Link>
        )}
        {quote && (
          <Link to="/app/quotes/$quoteId/print" params={{ quoteId: quote.id }} className={buttonClass('secondary')}>Print quote</Link>
        )}
        </div>
      </Container>
      <Container header={{ title: 'Site' }}>
        <div className="flex flex-col gap-2 text-sm">
        <p className="text-text">{booking.siteCity ?? booking.siteProvince ?? '--'}</p>
        {(booking.siteContact || booking.siteContactMobile) && (
          <p className="text-text-muted">
            Contact: <SiteRepContact name={booking.siteContact} mobile={booking.siteContactMobile} />
          </p>
        )}
        {booking.siteNotes && <p className="text-text-muted">Access: {booking.siteNotes}</p>}
        <SiteProofAdmin siteId={booking.projectSiteId} />
        {booking.status === 'active' && <SiteEquipmentWeather siteId={booking.projectSiteId} />}
        {booking.items.map((item) => (
          <div key={item.id} className="flex flex-col gap-1">
            <p className="text-text-muted">{item.equipmentName ?? 'Machine'}: {formatDate(item.start)} - {formatDate(item.end)}</p>
            {item.returnConditionNotes && <p className="whitespace-pre-wrap text-text">Condition on return: {item.returnConditionNotes}</p>}
            {item.returnNeedsRepair && <StatusBadge status="maintenance" label="Sent for repair" />}
          </div>
        ))}
        </div>
      </Container>
      <DeliveryCard booking={booking} />
      {['active', 'completed'].includes(booking.status) && <EdtrSheetCard bookingId={booking.id} printable />}
      <PendingRequests booking={booking} />
      {booking.status === 'confirmed' && <RescheduleCard booking={booking} />}
    </div>
  );
}
