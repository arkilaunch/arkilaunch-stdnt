import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseEdtrSheetQr, type EdtrCaptureResponse, type EdtrDetailResponse, type ScanTarget } from '@arkilaunch/shared';
import { apiGet, apiPost, apiPostForm } from '../lib/api-client.js';
import { explainEdtrError, failureText } from '../lib/edtr-error.js';
import { announceQueueChange, isRetryable, uploadQueue } from '../lib/upload-queue.js';
import { addDaysIso, formatDate, formatStatus, shortCode, weekStart } from '../lib/format.js';
import { manilaDate } from '@arkilaunch/shared';
import { EMPTY_HOURS, HourFields, toLineItems, type HourFieldValues } from './hour-fields.js';
import { Button } from './button.js';
import { CaptureField } from './capture-field.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Surface } from './surface.js';
import { Modal } from './modal.js';
import { ParsedColumns, ScanReview } from './scan-review.js';
import { edtrQueries, referenceQueries } from '../lib/queries.js';
import { readSheetQr } from '../lib/sheet-qr.js';
import { PAGE_MM } from '../lib/sheet-marks.js';
import { useToast } from './toast.js';

const TERMINAL_STATUSES = new Set(['review', 'reconciled', 'hard_failed']);
// Letter and Legal, as the sheet is printed.
const SHEET_RATIOS = Object.values(PAGE_MM).map((page) => page.w / page.h);

const SCANNING_TIPS = [
  {
    title: 'Good light',
    detail: 'Light the sheet evenly and keep overhead glare off the glossy parts.',
  },
  {
    title: 'Flat, on a plain surface',
    detail: 'Lay the sheet flat on a table, not held in your hand, so the lines stay straight.',
  },
  {
    title: 'All four black corner squares',
    detail: 'Keep the four small black squares in view and your fingers off them: they let the app crop and turn the sheet for you.',
  },
  { title: 'No shadow, hold still', detail: 'Stand so your shadow is off the sheet, and hold steady so the numbers stay sharp.' },
];

export const targetLabel = (t: ScanTarget) =>
  [t.siteName, t.bookingCode, t.customerName].filter(Boolean).join(' · ');

export interface CaptureModalProps {
  open: boolean;
  onClose: () => void;
  onCaptured: () => void;
  /** Only this site's bookings (the site hub). */
  siteId?: string;
  initialRentalId?: string;
  initialSource?: 'digital_entry' | 'paper_ocr';
  submitOnly?: boolean;
}

// Mondays of every printed week in the rental, up to this week: a sheet covers Mon to Sun.
export function sheetWeeks(start: string, end: string, today = manilaDate(new Date())): string[] {
  const last = end < today ? end : today;
  const weeks: string[] = [];
  for (let d = weekStart(start); d <= last; d = addDaysIso(d, 7)) weeks.push(d);
  return weeks;
}

export function CaptureModal({
  open,
  onClose,
  siteId,
  onCaptured,
  initialRentalId,
  initialSource = 'digital_entry',
  submitOnly = false,
}: CaptureModalProps) {
  const toast = useToast();
  const [source, setSource] = useState<'digital_entry' | 'paper_ocr'>(initialSource);
  const [rentalId, setRentalId] = useState(initialRentalId ?? '');
  const [equipmentId, setEquipmentId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [hours, setHours] = useState<HourFieldValues>({ ...EMPTY_HOURS, running: '8' });
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Set when the photographed sheet's QR picked the booking and machine; the pickers then stay locked to it.
  const [fromQr, setFromQr] = useState(false);
  // The QR names a machine outside this user's scope: the photo is of the wrong sheet, so it is not sent.
  const [qrBlocked, setQrBlocked] = useState(false);
  // No QR found in the photo: usually the sheet is cut off. Old sheets without a QR can still go through.
  const [qrMissing, setQrMissing] = useState(false);
  const [qrOverride, setQrOverride] = useState(false);
  // One id per attempt: a retry after a lost response (or from the offline queue) returns the same log.
  const [captureId, setCaptureId] = useState(() => crypto.randomUUID());

  // QA 32: only bookings and machines the server will accept: on site now (and, for staff, just returned).
  const scanTargets = useQuery({ ...edtrQueries.scanTargets(), enabled: open });
  const targets = (scanTargets.data?.items ?? []).filter((t) => !siteId || t.siteId === siteId);

  // With the OCR pipeline on, a paper scan must not carry typed hours (422 line_items_not_accepted).
  const capabilities = useQuery(referenceQueries.capabilities());
  const ocrPipeline = capabilities.data?.ocrPipeline ?? false;

  const [pollUrl, setPollUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<EdtrDetailResponse | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (initialRentalId) setRentalId(initialRentalId);
  }, [initialRentalId]);

  useEffect(() => {
    setSource(initialSource);
  }, [initialSource]);

  // A day picked for one source or booking is not valid for another.
  useEffect(() => setReportDate(''), [source, rentalId]);

  // One booking or one machine to choose from: choose it.
  const onlyRental = targets.length === 1 ? targets[0]!.rentalId : null;
  useEffect(() => {
    if (onlyRental && !rentalId) setRentalId(onlyRental);
  }, [onlyRental, rentalId]);
  const target = targets.find((t) => t.rentalId === rentalId);
  const onlyUnit = target?.units.length === 1 ? target.units[0]!.equipmentId : null;
  useEffect(() => {
    if (onlyUnit) setEquipmentId(onlyUnit);
    else if (target && !target.units.some((u) => u.equipmentId === equipmentId)) setEquipmentId('');
  }, [onlyUnit, target, equipmentId]);

  // The printed sheet's QR names its booking and machine: match it before upload so nobody picks by hand.
  async function onScanFile(file: File | null) {
    setScanFile(file);
    setFromQr(false);
    setQrBlocked(false);
    setQrMissing(false);
    setQrOverride(false);
    if (!file) return;
    const raw = await readSheetQr(file);
    const qr = raw ? parseEdtrSheetQr(raw) : null;
    if (!qr) {
      setQrMissing(true);
      return;
    }
    const match = targets.find((t) => t.rentalId === qr.rentalId && t.units.some((u) => u.equipmentId === qr.equipmentId));
    if (!match) {
      setError({ payload: { error: 'sheet_unit_out_of_scope' } });
      setQrBlocked(true);
      return;
    }
    setError(null);
    setRentalId(match.rentalId);
    setEquipmentId(qr.equipmentId);
    setFromQr(true);
  }

  const capturedRef = useRef(onCaptured);
  capturedRef.current = onCaptured;

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  useEffect(() => {
    if (!pollUrl) return;
    async function tick() {
      try {
        const res = await apiGet<EdtrDetailResponse>(pollUrl!);
        setDetail(res);
        if (TERMINAL_STATUSES.has(res.status)) {
          stopPolling();
          capturedRef.current();
        }
      } catch (err) {
        setError(err);
        stopPolling();
      }
    }
    void tick();
    pollTimer.current = setInterval(tick, 3000);
    return stopPolling;
  }, [pollUrl]);

  function reset() {
    stopPolling();
    setPollUrl(null);
    setDetail(null);
    setError(null);
    setScanFile(null);
    setFromQr(false);
    setQrBlocked(false);
    setQrMissing(false);
    setQrOverride(false);
    setCaptureId(crypto.randomUUID());
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function capture(event: FormEvent) {
    event.preventDefault();
    // Enter in the date field still submits the form after the button is disabled.
    if (pollUrl) return;
    setError(null);
    setSubmitting(true);
    try {
      let res: EdtrCaptureResponse;
      const lineItems = toLineItems(hours);
      if (!lineItems && !(source === 'paper_ocr' && ocrPipeline)) {
        throw new Error('Enter the running hours, and only numbers of zero or more.');
      }
      if (source === 'digital_entry') {
        res = await apiPost<EdtrCaptureResponse>('/edtr', {
          source: 'digital_entry',
          rentalId,
          equipmentId,
          reportDate,
          lineItems,
          captureId,
        });
      } else {
        // Multipart carries strings only: hours travel JSON-encoded.
        const transcribed = !ocrPipeline && lineItems ? { lineItems: JSON.stringify(lineItems) } : {};
        const fields = { source: 'paper_ocr', rentalId, equipmentId, reportDate, captureId, ...transcribed };
        try {
          res = await apiPostForm<EdtrCaptureResponse>('/edtr', fields, scanFile ?? undefined);
        } catch (err) {
          // Weak signal on site: keep the photo on the phone rather than lose the day.
          if (!scanFile || !isRetryable(err)) throw err;
          await uploadQueue.enqueue({ id: captureId, fields, file: scanFile, fileName: scanFile.name, createdAt: Date.now() });
          announceQueueChange();
          toast.success('Saved on this phone', `${formatDate(reportDate)} will upload by itself when the signal is back.`);
          handleClose();
          return;
        }
      }
      // A paper sheet stays open so the timekeeper sees what was read while still on site.
      if (submitOnly && source === 'digital_entry') {
        toast.success('Sent to the office', `${formatDate(reportDate)} is pending approval.`);
        onCaptured();
        handleClose();
        return;
      }
      // res.pollUrl carries the /api/v1 prefix apiGet adds itself.
      setPollUrl(`/edtr/${res.id}`);
      toast.success(
        'Field log recorded',
        `${formatDate(reportDate)} - waiting for its matching log.`,
      );
      onCaptured();
    } catch (err) {
      setError(err);
      const { title, detail: why } = explainEdtrError(err);
      toast.error(title, why);
    } finally {
      setSubmitting(false);
    }
  }

  const explained = error != null ? explainEdtrError(error) : null;

  const unit = target?.units.find((u) => u.equipmentId === equipmentId);
  const equipmentLabel = unit ? `${unit.name} (${unit.serialNo})` : 'Not set';
  const rentalSessionLabel = target ? targetLabel(target) : 'Not set';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Record a field log"
      description="One day, one machine. Record it twice from two sources and the hours are matched before billing."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            {pollUrl ? 'Done' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            onClick={capture}
            loading={submitting}
            disabled={
              !reportDate ||
              !equipmentId ||
              pollUrl !== null ||
              qrBlocked ||
              (source === 'paper_ocr' && qrMissing && !qrOverride)
            }
          >
            Record log
          </Button>
        </>
      }
    >
      <form onSubmit={capture} className="flex flex-col gap-4">
        <fieldset className={submitOnly ?'hidden' : 'flex flex-col gap-2'}>
          <legend className="mb-1 text-sm font-medium text-text">How was it recorded?</legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <label className="flex min-h-11 items-center gap-2 text-text">
              <input
                type="radio"
                name="source"
                value="digital_entry"
                checked={source === 'digital_entry'}
                onChange={() => setSource('digital_entry')}
                className="h-5 w-5 accent-accent"
              />
              Typed in from the office
            </label>
            <label className="flex min-h-11 items-center gap-2 text-text">
              <input
                type="radio"
                name="source"
                value="paper_ocr"
                checked={source === 'paper_ocr'}
                onChange={() => setSource('paper_ocr')}
                className="h-5 w-5 accent-accent"
              />
              Photo of the paper sheet
            </label>
          </div>
        </fieldset>

        {fromQr && (
          <p role="status" className="rounded-sm border border-success/40 bg-success/10 px-3 py-2 text-sm text-text">
            Matched from the sheet&apos;s QR code: {equipmentLabel} at {rentalSessionLabel}.
          </p>
        )}
        <Select
          id="rentalId"
          label="Site and booking"
          value={rentalId}
          onChange={(e) => setRentalId(e.target.value)}
          disabled={fromQr}
          required
        >
          <option value="">
            {scanTargets.isPending ? 'Loading your sites…' : targets.length === 0 ? 'No machine is on site at your sites' : 'Choose the site'}
          </option>
          {targets.map((t) => (
            <option key={t.rentalId} value={t.rentalId}>
              {targetLabel(t)}
            </option>
          ))}
        </Select>

        <Select
          id="equipmentId"
          label="Machine on site"
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          disabled={fromQr || !target}
          required
        >
          <option value="">{target ? 'Choose the machine' : 'Choose the site first'}</option>
          {target?.units.map((u) => (
            <option key={u.equipmentId} value={u.equipmentId}>
              {u.name} ({u.serialNo}){u.onSite ? '' : ' - returned'}
            </option>
          ))}
        </Select>

        {source === 'paper_ocr' ? (
          <Select
            id="reportDate"
            label="Week of the sheet"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            disabled={!target?.startDate}
            required
          >
            <option value="">{target ? 'Choose the week' : 'Choose the site first'}</option>
            {target?.startDate &&
              sheetWeeks(manilaDate(target.startDate), manilaDate(target.endDate ?? new Date())).map((d) => (
                <option key={d} value={d}>
                  {formatDate(d)} to {formatDate(addDaysIso(d, 6))}
                </option>
              ))}
          </Select>
        ) : (
        <Input
          id="reportDate"
          label="Day worked"
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          required
          {...(target?.startDate ? { min: manilaDate(target.startDate) } : {})}
          {...(target?.endDate ? { max: manilaDate(target.endDate) } : {})}
          hint={
            target?.startDate
              ? `Within the rental: ${formatDate(target.startDate)} to ${target.endDate ? formatDate(target.endDate) : 'open'}`
              : undefined
          }
        />
        )}

        {source === 'paper_ocr' && (
          <CaptureField
            id="scanFile"
            label="Photo of the sheet"
            accept="image/*"
            size="field"
            scanner
            sheetMarks
            snapAspect={SHEET_RATIOS}
            value={scanFile}
            onChange={(file) => void onScanFile(file)}
            tips={SCANNING_TIPS}
            sessionData={[
              { label: 'Machine', value: equipmentLabel },
              { label: 'Rental', value: rentalSessionLabel },
              { label: 'Day worked', value: reportDate ? formatDate(reportDate) : 'Not set' },
            ]}
          />
        )}

        {source === 'paper_ocr' && qrMissing && (
          <Surface radius="md" elevation="sm" className="flex flex-col gap-2 border-recon-review p-3">
            <p className="text-sm text-text">
              The sheet's QR code is not in the photo. Fit the whole sheet in the frame, including the QR corner, and retake.
            </p>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input type="checkbox" checked={qrOverride} onChange={(e) => setQrOverride(e.target.checked)} />
              This is an older sheet without a QR code
            </label>
          </Surface>
        )}

        {!(source === 'paper_ocr' && ocrPipeline) && <HourFields value={hours} onChange={setHours} idPrefix="capture" />}
        {source === 'paper_ocr' && !ocrPipeline && (
          <p className="-mt-2 text-sm text-text-muted">
            Type the hours exactly as written on the sheet. The photo is kept either way, so the
            original can always be checked against what was billed.
          </p>
        )}
        {source === 'paper_ocr' && ocrPipeline && (
          <p className="-mt-2 text-sm text-text-muted">
            The hours are read off the sheet itself, so there is nothing to type here. Anything read
            below 90% certainty comes back for a person to check.
          </p>
        )}

        {explained && (
          <Surface radius="md" elevation="sm" className="border-error p-3">
            <p className="text-sm font-semibold text-error">{explained.title}</p>
            <p className="mt-1 text-sm text-text">{explained.detail}</p>
          </Surface>
        )}

        {detail && (
          <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-3">
            <p className="text-sm text-text">
              Recorded as <span className="font-mono text-xs">{shortCode('log', detail.id)}</span> -{' '}
              {formatStatus(detail.status)}.
            </p>
            {detail.status === 'hard_failed' && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-text">{failureText(detail.failureReason)}</p>
                <div>
                  {/* reset() keeps booking, machine and day: only the photo needs redoing. */}
                  <Button variant="primary" onClick={reset}>
                    Retake the photo
                  </Button>
                </div>
              </div>
            )}
            {!TERMINAL_STATUSES.has(detail.status) && (
              <p className="text-sm text-text-muted">Reading the sheet... this usually takes under a minute.</p>
            )}
            {/* What was read, column by column, so a misread is caught on site rather than at billing. */}
            {detail.lineItems[0] && <ParsedColumns item={detail.lineItems[0]} />}
            {detail.source === 'paper_ocr' && detail.fields.length > 0 && <ScanReview detail={detail} />}
            {detail.reconciliation?.status === 'single_source' && (
              <p className="text-sm text-text-muted">
                Waiting for the second record of this machine-day before anything can be billed.
              </p>
            )}
          </Surface>
        )}
      </form>
    </Modal>
  );
}
