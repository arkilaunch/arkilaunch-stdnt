import type { RentPart } from '@arkilaunch/shared';
import type { QuoteDetail, QuoteLine } from '../lib/queries.js';
import { formatPeso } from '../lib/format.js';
import { PriceBreakdown } from './truck-trip.js';

const UNIT: Record<string, [string, string, string]> = {
  hourly: ['hr', 'hour', 'hours'],
  daily: ['day', 'day', 'days'],
  monthly: ['mo', 'month', 'months'],
};

function count(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function rentText(parts: RentPart[]): string {
  return parts
    .map((part) => {
      const [short, one, many] = UNIT[part.rateType] ?? ['unit', 'unit', 'units'];
      return `${formatPeso(part.ratePhp)}/${short} × ${count(part.count)} ${part.count === 1 ? one : many}`;
    })
    .join(' + ');
}

function lineName(line: QuoteLine, typeName?: (id: string) => string): string {
  if (line.kind === 'custom') return line.description ?? 'Item';
  return line.equipmentTypeName ?? (line.equipmentTypeId && typeName ? typeName(line.equipmentTypeId) : 'Equipment');
}

function lineDetail(line: QuoteLine, detailed = false): string {
  if (line.kind === 'custom') return `${formatPeso(line.subtotal / line.quantity)} each`;
  if (line.rateBreakdown) return `${formatPeso(line.rateBreakdown.allIn)}/hr all-in × ${count(line.estimatedHours)} hours`;
  // Quotes from before per-unit pricing carry no rent breakdown.
  if (line.rentParts.length === 0) return `${line.estimatedHours} h at ${formatPeso(line.hourlyRate)}/h`;
  const extras = line.operatingCost - line.rent * (detailed ? line.quantity : 1) + line.buffer;
  return `${detailed ? 'Rental rate per unit: ' : ''}${rentText(line.rentParts)}${extras > 0.005 ? `, plus ${formatPeso(extras)} operator, fuel and upkeep${detailed ? ' across this line' : ''}` : ''}`;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ?'text-text' : 'text-text-muted'}>{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

// Same look as the trucking breakdown; the summary says "per hour", so Total reads as the all-in rate.
function RateBreakdownList({ line, expanded }: { line: QuoteLine; expanded: boolean }) {
  const b = line.rateBreakdown!;
  const lines = [
    { label: 'Rent', amountPhp: b.rent },
    { label: 'Operator', amountPhp: b.operator },
    { label: 'Maintenance', amountPhp: b.maintenance },
    { label: `Fuel (${formatPeso(b.dieselPhp)}/L diesel)`, amountPhp: b.fuel },
  ];
  return (
    <details open={expanded} className="mt-2 max-w-sm text-sm">
      <summary className="cursor-pointer text-text-muted">Price breakdown per hour</summary>
      <div className="mt-2">
        <PriceBreakdown price={{ km: 0, lines, totalPhp: b.allIn }} />
        <p className="mt-1 text-xs text-text-muted">
          × {count(line.estimatedHours)} {line.estimatedHours === 1 ? 'hour' : 'hours'} × {line.quantity} {line.quantity === 1 ? 'unit' : 'units'}
        </p>
      </div>
    </details>
  );
}

export function QuoteLines({ quote, typeName, detailed = false, expandRates = false }: { quote: QuoteDetail; expandRates?: boolean; typeName?: (id: string) => string; detailed?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {quote.lineItems.length === 0 && (
        <p className="rounded-md bg-surface-sunk p-3 text-sm text-text-muted">This revision was saved without an itemized breakdown.</p>
      )}
      <ul aria-label="Quote line items" className="flex flex-col gap-2 border-b border-border pb-3">
        {quote.lineItems.map((line, i) => (
          <li key={i} className={`flex items-start justify-between gap-3 text-sm ${detailed ? 'flex-wrap rounded-md bg-surface-sunk p-4' : ''}`}>
            <div className="min-w-0 flex-1 text-text">
              {line.quantity} &times; {lineName(line, typeName)}
              <span className={`block text-text-muted ${detailed ? 'mt-2 text-sm' : 'text-xs'}`}>{detailed && line.kind === 'equipment' ? 'Pricing basis: ' : ''}{lineDetail(line, detailed)}</span>
              {line.kind === 'equipment' && line.rateBreakdown && <RateBreakdownList line={line} expanded={expandRates} />}
              {detailed && line.kind === 'equipment' && (
                <span className="mt-1 block text-sm text-text-muted">{count(line.estimatedHours)} quoted billable hours per unit</span>
              )}
              {detailed && line.quantity > 1 && (
                <span className="mt-1 block text-sm text-text-muted">{formatPeso(line.subtotal / line.quantity)} average per unit before booking-level fees and discount</span>
              )}
            </div>
            <span className={`font-mono text-text ${detailed ? 'text-base font-semibold' : ''}`}>
              {detailed && <span className="mb-1 block font-sans text-sm font-normal text-text-muted">Quoted line total</span>}
              {formatPeso(line.subtotal)}
            </span>
          </li>
        ))}
      </ul>
      {quote.mobilization > 0 && <Row label="Mobilization" value={formatPeso(quote.mobilization)} />}
      {quote.demobilization > 0 && <Row label="Demobilization" value={formatPeso(quote.demobilization)} />}
      <Row label="Subtotal" value={formatPeso(quote.subtotal)} />
      {quote.discount > 0 && <Row label="Discount" value={`- ${formatPeso(quote.discount)}`} />}
      <Row label={detailed ? 'Quoted rental total' : 'Total'} value={formatPeso(quote.total)} strong />
    </div>
  );
}
