import { useEffect, useState } from 'react';
import type { EdtrDetailResponse } from '@arkilaunch/shared';
import { apiGet } from '../lib/api-client.js';
import { rotateImage, toScannedPage } from '../lib/document-scanner.js';
import { formatHours } from '../lib/format.js';
import { ConfidenceChip } from './confidence-chip.js';
import { Surface } from './surface.js';
import { Modal } from './modal.js';

// Boxes only where a polygon exists: inventing a position would tell the reviewer the model read a cell it did not.

export interface ScanReviewProps {
  detail: EdtrDetailResponse;
  /** Approvers save the turn for everyone; without it the turn is for this screen only. */
  onRotate?: ((degrees: Rotation) => void) | undefined;
}

export type Rotation = 0 | 90 | 180 | 270;

// A box on the page (fractions of width/height) after turning the page clockwise.
export function rotateBox<T extends { left: number; top: number; width: number; height: number }>(box: T, degrees: Rotation): T {
  const { left, top, width, height } = box;
  if (degrees === 90) return { ...box, left: 1 - top - height, top: left, width: height, height: width };
  if (degrees === 180) return { ...box, left: 1 - left - width, top: 1 - top - height };
  if (degrees === 270) return { ...box, left: top, top: 1 - left - width, width: height, height: width };
  return box;
}

interface Box {
  name: string;
  belowGate: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

function toBox(field: EdtrDetailResponse['fields'][number]): Box | null {
  const polygon = field.boundingRegion?.polygon;
  if (!polygon || polygon.length < 8 || polygon.length % 2 !== 0) return null;
  const xs = polygon.filter((_, i) => i % 2 === 0);
  const ys = polygon.filter((_, i) => i % 2 === 1);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  if (!(width > 0 && height > 0)) return null;
  return { name: field.name, belowGate: field.belowGate, left, top, width, height };
}

type LineItem = EdtrDetailResponse['lineItems'][number];

// Every column the sheet carries, in its printed order; `billed` marks the one the deposit is charged on.
const COLUMNS: { label: string; value: (item: LineItem) => number | null | undefined; billed?: boolean; meter?: boolean }[] = [
  { label: 'Running', value: (item) => item.hoursActive, billed: true },
  { label: 'Idle', value: (item) => item.hoursIdle },
  { label: 'Breakdown', value: (item) => item.hoursBreakdown },
  { label: 'Weather', value: (item) => item.hoursWeather },
  { label: 'Other downtime', value: (item) => item.hoursOtherDowntime },
  { label: 'Total written', value: (item) => item.hoursTotal },
  { label: 'Hour meter start', value: (item) => item.hourMeterStart, meter: true },
  { label: 'Hour meter end', value: (item) => item.hourMeterEnd, meter: true },
];

const FLAG_TEXT: Record<string, string> = {
  sheet_qr_mismatch: 'The sheet QR names a different booking or machine.',
  sheet_unidentified: 'No QR code was found on the sheet.',
};

export function ParsedColumns({ item }: { item: LineItem }) {
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">What the sheet says for this day</caption>
        <tbody>
          {COLUMNS.map((column) => {
            const value = column.value(item);
            return (
              <tr key={column.label} className={column.billed ? 'bg-recon-match/10 font-semibold' : ''}>
                <th scope="row" className="h-8 px-2 text-left font-normal text-text-muted">
                  {column.label}
                  {column.billed && <span className="ml-1 text-xs text-text">(billed)</span>}
                </th>
                <td className="h-8 px-2 text-right font-mono tabular-nums text-text">
                  {/* Blank is not zero: null means nothing was read or written. */}
                  {value == null ? '--' : column.meter ? value.toFixed(1) : formatHours(value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {item.downtimeNote && <p className="text-sm text-text">Note: {item.downtimeNote}</p>}
      {item.reviewFlags && item.reviewFlags.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-text-muted">
          {item.reviewFlags.map((flag) => (
            <li key={flag}>{FLAG_TEXT[flag] ?? flag.replaceAll('_', ' ')}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ZOOMS = [1, 1.5, 2, 3, 4] as const;

// Anything but a quarter-turn value (an older API without the field) starts upright.
function asRotation(value: unknown): Rotation {
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

export function ScanReview({ detail, onRotate }: ScanReviewProps) {
  // Local state leads: only a different log resets it, so a save or refetch never undoes a click.
  const [rotation, setRotation] = useState<Rotation>(asRotation(detail.scanRotation));
  useEffect(() => setRotation(asRotation(detail.scanRotation)), [detail.id]);
  // 0 -> 90 -> 180 -> 270 -> 0, clockwise every press.
  function turn() {
    const next = asRotation((rotation + 90) % 360);
    setRotation(next);
    onRotate?.(next);
  }
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [view, setView] = useState<'scanned' | 'original'>('original');
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const [scanFailed, setScanFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    setImageUnavailable(false);
    // Signed (300s) and re-fetched per review: the scan is never a public URL.
    apiGet<{ url: string }>(`/edtr/${detail.id}/image`)
      .then((res) => {
        if (!cancelled) setImageUrl(res.url);
      })
      .catch(() => {
        if (!cancelled) setImageUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  useEffect(() => {
    if (!imageUrl || view !== 'scanned' || scannedUrl || scanFailed) return;
    let cancelled = false;
    toScannedPage(imageUrl)
      .then((url) => {
        if (!cancelled) setScannedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setScanFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, view, scannedUrl, scanFailed]);

  const base = view === 'scanned' && scannedUrl ? scannedUrl : imageUrl;
  // The turned picture is drawn, not CSS-transformed: the frame then always wraps it exactly.
  const [turned, setTurned] = useState<{ from: string; degrees: Rotation; url: string } | null>(null);
  const [turnFailed, setTurnFailed] = useState(false);
  useEffect(() => {
    setTurnFailed(false);
    if (!base || rotation === 0) return;
    let cancelled = false;
    rotateImage(base, rotation)
      .then((url) => {
        if (!cancelled) setTurned({ from: base, degrees: rotation, url });
      })
      .catch(() => {
        if (!cancelled) setTurnFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base, rotation]);
  const ready = rotation !== 0 && turned?.from === base && turned.degrees === rotation;
  // Until the turned picture exists (or if it cannot be made), the unturned one stays, boxes matching it.
  const shown = ready ? turned!.url : base;
  const boxRotation: Rotation = ready ? rotation : 0;

  const boxes = detail.fields
    .map(toBox)
    .filter((box): box is Box => box !== null)
    .map((box) => rotateBox(box, boxRotation));
  const needsReview = detail.fields.filter((field) => field.belowGate);

  // The page with its boxes; the frame is exactly the picture's size, so box percentages land on the page.
  const page = (imageClass: string, frameClass: string) =>
    shown && (
      <div className={`relative overflow-hidden rounded-sm border border-border bg-surface ${frameClass}`}>
        <img src={shown} alt="The scanned sheet, with the readings the model took marked on it" className={`block ${imageClass}`} />
        {boxes.map((box) => (
          <span
            key={box.name}
            title={box.name}
            className={[
              'pointer-events-none absolute border-2',
              box.belowGate ? 'border-recon-review bg-recon-review/20' : 'border-recon-match',
            ].join(' ')}
            style={{
              left: `${box.left * 100}%`,
              top: `${box.top * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
          />
        ))}
      </div>
    );
  const rotateButton = (
    <button
      type="button"
      onClick={turn}
      className="rounded-sm border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-black/5"
      aria-label={`Rotate clockwise 90 degrees, now at ${rotation} degrees`}
    >
      Rotate 90° ↻
    </button>
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        {imageUrl && (
          <div className="mb-2 flex items-center gap-2" role="group" aria-label="How to show the sheet">
            {/* The photo first: it is what the reader saw. B/W is an optional aid, and can speckle on shadowed shots. */}
            {(['original', 'scanned'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={[
                  'rounded-sm border px-3 py-1 text-sm',
                  view === option ? 'border-primary bg-primary text-on-primary' : 'border-border text-text',
                ].join(' ')}
              >
                {option === 'scanned' ? 'Black & white' : 'Photo'}
              </button>
            ))}
            {rotateButton}
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              disabled={!shown}
              className="rounded-sm border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-black/5"
            >
              Enlarge
            </button>
            {turnFailed && <span className="text-xs text-text-muted">This photo cannot be turned here.</span>}
            {view === 'scanned' && !scannedUrl && (
              <span className="text-xs text-text-muted">
                {scanFailed ? 'Black-and-white view unavailable; showing the original.' : 'Preparing the scan...'}
              </span>
            )}
          </div>
        )}
        {shown ? (
          // Click the page to open it full screen.
          <button type="button" onClick={() => setZoomOpen(true)} className="mx-auto block w-fit max-w-full cursor-zoom-in" aria-label="Enlarge the sheet">
            {page('h-auto max-h-[80vh] w-auto max-w-full', 'w-fit max-w-full')}
          </button>
        ) : imageUnavailable ? (
          <p className="text-sm text-text-muted">
            The scanned page could not be loaded, so only the readings below are shown.
          </p>
        ) : (
          <p className="text-sm text-text-muted">Loading the scanned page...</p>
        )}
        <Modal open={zoomOpen} onClose={() => setZoomOpen(false)} size="full" title="Field sheet">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Zoom">
              <button
                type="button"
                onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!)}
                disabled={zoom === ZOOMS[0]}
                className="rounded-sm border border-border px-3 py-1.5 text-sm font-medium text-text disabled:opacity-50"
                aria-label="Zoom out"
              >
                -
              </button>
              <span className="w-14 text-center font-mono text-sm tabular-nums text-text" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!)}
                disabled={zoom === ZOOMS[ZOOMS.length - 1]}
                className="rounded-sm border border-border px-3 py-1.5 text-sm font-medium text-text disabled:opacity-50"
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="rounded-sm border border-border px-3 py-1.5 text-sm font-medium text-text"
              >
                Fit
              </button>
              {rotateButton}
            </div>
            {/* Zoomed, the page grows past the screen and is moved by scrolling (or dragging on a phone). */}
            <div className="max-h-[calc(100dvh-10rem)] overflow-auto rounded-sm bg-black/5">
              <div style={{ width: `${zoom * 100}%` }}>{page('h-auto w-full', 'w-full')}</div>
            </div>
          </div>
        </Modal>
        {boxes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 border-2 border-recon-match" /> Read confidently
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 border-2 border-recon-review bg-recon-review/20" /> Needs a
              look
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:sticky lg:top-0 lg:w-80">
        {detail.lineItems[0] && <ParsedColumns item={detail.lineItems[0]} />}
        <div className="flex flex-wrap gap-2">
          {detail.fields.map((field) => (
            <ConfidenceChip
              key={field.name}
              fieldLabel={field.name}
              confidence={field.confidence}
              tone={field.belowGate ? 'review' : 'match'}
            />
          ))}
        </div>

        {needsReview.length > 0 && (
          <Surface radius="md" elevation="sm" className="border-recon-review p-3">
            <p className="text-sm font-semibold text-text">Check these before approving</p>
            <ul className="mt-2 flex flex-col gap-2">
              {needsReview.map((field) => (
                <li key={field.name} className="text-sm">
                  <span className="font-medium text-text">{field.name}</span>{' '}
                  <span className="font-mono tabular-nums text-text">{String(field.value)}</span>
                  <span className="block text-text-muted">
                    Read at {(field.confidence * 100).toFixed(0)}% certainty, under the 90% needed
                    to accept it without a person.
                  </span>
                </li>
              ))}
            </ul>
            {/* A correction is not an approval: the reading still goes through reconciliation. */}
            <p className="mt-3 text-sm text-text-muted">
              Correcting a reading still leaves it to be matched against the second record of this
              machine-day before anything is billed.
            </p>
          </Surface>
        )}
      </div>
    </div>
  );
}
