import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WEEK_SUMMARY_TOLERANCE_HOURS,
  type EdtrWeekBillResponse,
  type EdtrWeekResponse,
} from '@arkilaunch/shared';
import { apiErrorText, apiGet, apiPost } from '../lib/api-client.js';
import { formatDate, formatPeso } from '../lib/format.js';
import { Button } from './button.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { useToast } from './toast.js';

// Under one machine's week: the approved days added up, checked against the sheet's WEEK SUMMARY, then
// "Approve & bill". Each day is still decided on its own (Review and bill); this only bills the week (RFC-2).
export function WeekBillBar({ rentalId, equipmentId, weekStart }: { rentalId: string; equipmentId: string; weekStart: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const week = useQuery({
    queryKey: ['edtr', 'week', rentalId, equipmentId, weekStart] as const,
    queryFn: () => apiGet<EdtrWeekResponse>(`/edtr/weeks/${rentalId}/${equipmentId}/${weekStart}`),
  });
  const [sheetText, setSheetText] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noWorkReasons, setNoWorkReasons] = useState<Record<string, string>>({});
  const [correctionReason, setCorrectionReason] = useState('');
  const [confirm, setConfirm] = useState(false);

  const bill = useMutation({
    mutationFn: (body: { weekBillableHours: number; sheetBillableHours: number | null; mismatchNote?: string; noWorkDays?: { equipmentId: string; day: string; reason: string }[]; correctionReason?: string }) =>
      apiPost<EdtrWeekBillResponse>(`/edtr/weeks/${rentalId}/${equipmentId}/${weekStart}/bill`, body),
    onSuccess: (res) => {
      toast.success(
        res.invoiceId ? `Week billed: ${formatPeso(res.amountPhp)}` : 'Week approved; the deposit covers it',
        res.soaEmailedTo ? `The invoice and the SOA were sent to ${res.soaEmailedTo}.` : 'The SOA is updated.',
      );
      setNote('');
    },
    onError: (err) => toast.error('The week was not billed', apiErrorText(err)),
    onSettled: () => {
      setConfirm(false);
      void queryClient.invalidateQueries({ queryKey: ['edtr'] });
    },
  });

  const data = week.data;
  if (week.isError) return <p className="border-t border-border px-4 py-2 text-xs text-error">Week total unavailable: {apiErrorText(week.error)}</p>;
  if (!data) return null;

  const total = data.totals.billable;
  const sheet = sheetText !== null ? (sheetText.trim() === '' ? null : Number(sheetText)) : (data.sheetSummary?.billable ?? null);
  const sheetOk = sheet === null || (Number.isFinite(sheet) && sheet >= 0);
  const mismatch = sheet !== null && sheetOk && Math.abs(sheet - total) > WEEK_SUMMARY_TOLERANCE_HOURS;
  const undecided = data.days.filter((d) => d.status === 'pending' || d.status === 'needs_correction').length;
  const missing = data.closureDays?.filter((day) => day.status === 'missing') ?? [];
  const openAcrossRental = data.closureDays?.filter((day) => day.status !== 'approved' && day.status !== 'missing').length ?? undecided;
  const noWorkReady = missing.every((day) => (noWorkReasons[`${day.equipmentId}|${day.day}`] ?? '').trim().length >= 3);
  const canBill = (!data.closedAt || data.reissueAllowed) && data.billState !== 'billed' && openAcrossRental === 0 && sheetOk && (!mismatch || note.trim().length >= 3);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface-sunk px-4 py-2 text-sm">
      <span>
        Week billable <span className="font-mono font-semibold tabular-nums">{total.toFixed(1)} h</span>
      </span>
      <label className="flex items-center gap-1 text-text-muted">
        Sheet
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.5"
          value={sheetText ?? (data.sheetSummary?.billable ?? '').toString()}
          onChange={(e) => setSheetText(e.target.value)}
          placeholder="--"
          aria-label="Sheet WEEK SUMMARY billable hours"
          className="h-8 w-16 rounded-input border border-border bg-surface px-1 text-right font-mono text-text"
        />
        h
      </label>
      {sheet !== null && sheetOk && (
        mismatch ? (
          <span className="text-warning">⚠ differs by {Math.abs(sheet - total).toFixed(1)} h</span>
        ) : (
          <span className="text-success">✓ matches the sheet</span>
        )
      )}
      {mismatch && data.billState !== 'billed' && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Reason it differs (needed to bill)"
          aria-label="Reason the week differs from the sheet"
          className="h-8 min-w-[14rem] flex-1 rounded-input border border-border bg-surface px-2 text-text"
        />
      )}
      <span className="ml-auto flex items-center gap-2">
        {data.reissueAllowed ? (
          <Button variant="approve" size="field" disabled={!canBill} loading={bill.isPending} onClick={() => setConfirm(true)}>Review &amp; reissue</Button>
        ) : data.closedAt || data.billState === 'billed' ? (
          <span className="text-success">✓ {data.billState === 'billed' ? 'Billed' : data.billState === 'covered' ? 'Week closed; covered by deposit' : 'Week closed'}{data.closedAt ? ` ${formatDate(data.closedAt.slice(0, 10))}` : data.lastBilledAt ? ` ${formatDate(data.lastBilledAt.slice(0, 10))}` : ''}</span>
        ) : data.billState === 'covered' && undecided === 0 && total > 0 ? (
          <>
            <span className="text-success">✓ Paid from deposit</span>
            <Button variant="secondary" size="field" disabled={!canBill} loading={bill.isPending} onClick={() => setConfirm(true)}>
              Send statement
            </Button>
          </>
        ) : (
          <>
            {undecided > 0 && (
              <span className="text-xs text-text-muted">
                {undecided} day{undecided === 1 ? '' : 's'} still pending
              </span>
            )}
            <Button variant="approve" size="field" disabled={!canBill} loading={bill.isPending} onClick={() => setConfirm(true)}>
              Approve &amp; bill
            </Button>
          </>
        )}
      </span>
      <ConfirmDialog
        open={confirm}
        tone="approve"
        title={`Bill ${total.toFixed(1)} h for the week of ${formatDate(weekStart)}?`}
        body={
          <div className="space-y-3">
            <p>The customer gets one rental invoice for the week. Deposit applied to each machine is shown separately. The Statement of Account is emailed.</p>
            {data.reissueAllowed && <label className="block text-sm">Reason for correction
              <input className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-text" maxLength={500}
                value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Why this closed week is being reissued" />
            </label>}
            {!data.reissueAllowed && missing.map((day) => <label key={`${day.equipmentId}|${day.day}`} className="block text-sm">
              Confirm no work: {day.label}, {formatDate(day.day)}
              <input className="mt-1 w-full rounded-input border border-border bg-surface px-2 py-1 text-text" maxLength={500}
                value={noWorkReasons[`${day.equipmentId}|${day.day}`] ?? ''}
                onChange={(event) => setNoWorkReasons((current) => ({ ...current, [`${day.equipmentId}|${day.day}`]: event.target.value }))}
                placeholder="Staff reason (required)" />
            </label>)}
          </div>
        }
        confirmLabel="Approve & bill"
        pending={bill.isPending}
        onConfirm={async () => {
          if (data.reissueAllowed && correctionReason.trim().length < 3) { toast.error('Reason needed', 'Enter why this closed week is being reissued.'); return; }
          if (!data.reissueAllowed && !noWorkReady) { toast.error('Confirm no work', 'Enter a reason for each missing machine-day before closing the week.'); return; }
          await bill
            .mutateAsync({
              weekBillableHours: total,
              sheetBillableHours: sheet,
              ...(note.trim() ? { mismatchNote: note.trim() } : {}),
              noWorkDays: data.reissueAllowed ? [] : missing.map((day) => ({ equipmentId: day.equipmentId, day: day.day, reason: noWorkReasons[`${day.equipmentId}|${day.day}`]!.trim() })),
              ...(data.reissueAllowed ? { correctionReason: correctionReason.trim() } : {}),
            })
            .catch(() => undefined);
        }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
