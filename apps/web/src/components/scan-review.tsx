import { useEffect, useState } from 'react';
import type { EdtrDetailResponse } from '@arkilaunch/shared';
import { apiGet } from '../lib/api-client.js';
import { toScannedPage } from '../lib/document-scanner.js';
import { formatHours } from '../lib/format.js';
import { ConfidenceChip } from './confidence-chip.js';
import { Surface } from './surface.js';

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
      <table className="w-full text-sm">
        <caption className="sr-only">What the sheet says for this day</caption>
        <tbody>
          {COLUMNS.map((column) => {
            const value = column.value(item);
            return (
              <tr key={column.label} className={column.billed ? 'bg-recon-match/10 font-semibold' : ''}>
                <th scope="row" className="py-1 pr-3 text-left font-normal text-text-muted">
                  {column.label}
                  {column.billed && <span className="ml-1 text-xs text-text">(billed)</span>}
                </th>
                <td className="py-1 text-right font-mono tabular-nums text-text">
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

export function ScanReview({ detail, onRotate }: ScanReviewProps) {
  const [rotation, setRotation] = useState<Rotation>(detail.scanRotation);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setRotation(detail.scanRotation), [detail.id, detail.scanRotation]);
  function turn() {
    const next = ((rotation + 90) % 360) as Rotation;
    setRotation(next);
    onRotate?.(next);
  }
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [view, setView] = useState<'scanned' | 'original'>('scanned');
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

  const shown = view === 'scanned' && scannedUrl ? scannedUrl : imageUrl;

  const boxes = detail.fields
    .map(toBox)
    .filter((box): box is Box => box !== null)
    .map((box) => rotateBox(box, rotation));
  const sideways = rotation === 90 || rotation === 270;
  // Turned a quarter, the frame takes the page's swapped shape and the image is centred and turned inside it.
  const ratio = natural ? natural.w / natural.h : null;
  const needsReview = detail.fields.filter((field) => field.belowGate);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex-1">
        {imageUrl && (
          <div className="mb-2 flex items-center gap-2" role="group" aria-label="How to show the sheet">
            {(['scanned', 'original'] as const).map((option) => (
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
                {option === 'scanned' ? 'Scanned' : 'Original'}
              </button>
            ))}
            <button
              type="button"
              onClick={turn}
              className="rounded-sm border border-border px-3 py-1 text-sm text-text"
              aria-label={`Rotate the sheet 90 degrees, now at ${rotation} degrees`}
            >
              Rotate 90°
            </button>
            {view === 'scanned' && !scannedUrl && (
              <span className="text-xs text-text-muted">
                {scanFailed ? 'Black-and-white view unavailable; showing the original.' : 'Preparing the scan...'}
              </span>
            )}
          </div>
        )}
        {shown ? (
          <div
            className="relative w-full overflow-hidden rounded-sm border border-border"
            style={ratio ? { aspectRatio: sideways ? 1 / ratio : ratio } : undefined}
          >
            <img
              src={shown}
              alt="The scanned sheet, with the readings the model took marked on it"
              onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
              className={ratio ? 'absolute left-1/2 top-1/2 max-w-none' : 'w-full'}
              style={
                ratio
                  ? {
                      // Sized to the unturned page, so after the turn it fills the frame exactly.
                      width: sideways ? `${ratio * 100}%` : '100%',
                      height: sideways ? `${100 / ratio}%` : '100%',
                      transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                    }
                  : undefined
              }
            />
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
        ) : imageUnavailable ? (
          <p className="text-sm text-text-muted">
            The scanned page could not be loaded, so only the readings below are shown.
          </p>
        ) : (
          <p className="text-sm text-text-muted">Loading the scanned page...</p>
        )}
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

      <div className="flex flex-col gap-3 lg:w-80">
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
