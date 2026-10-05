import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { appLayoutRoute } from './_app.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { manilaDate, type LeakageFinding, type LeakageKpi, type LeakageReport, type LeakageReportQuery, type StatementPdfResponse } from '@arkilaunch/shared';
import { leakageParams, referenceQueries, reportQueries } from '../lib/queries.js';
import { apiErrorText, apiGet } from '../lib/api-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { Modal } from '../components/modal.js';
import { SegmentedControl } from '../components/segmented-control.js';
import { useToast } from '../components/toast.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { StatTile } from '../components/stat-tile.js';
import { formatPeso } from '../lib/format.js';
import { FileDown } from 'lucide-react';

const formatKpi = (k: LeakageKpi) =>
  k.value === null ? null : k.unit === 'php' ? formatPeso(k.value) : k.unit === 'pct' ? `${k.value.toFixed(1)}%` : `${k.value.toFixed(1)} days`;

const KIND_LABEL: Record<LeakageFinding['kind'], string> = {
  lost: 'Lost unless acted on',
  delayed: 'Cash delayed',
  opportunity: 'Missed opportunity',
};
const SEVERITY_CLASS: Record<LeakageFinding['severity'], string> = {
  high: 'border-error/40 bg-error/10 text-error',
  medium: 'border-warning/40 bg-warning/10 text-text',
  low: 'border-border bg-surface-sunk text-text-muted',
};

// QA 35: one leak, readable at a glance (what, how much, how urgent), with the why, the fix and the evidence one tap away.
function FindingCard({ f, index }: { f: LeakageFinding; index: number }) {
  const none = f.amountPhp <= 0 && f.count === 0;
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-heading-md text-text">
            {index}. {f.title}
          </h3>
          <p className="text-xs text-text-muted">
            {KIND_LABEL[f.kind]} · {f.count} item{f.count === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!none && (
            <span className={['rounded-sm border px-2 py-0.5 text-xs font-semibold uppercase', SEVERITY_CLASS[f.severity]].join(' ')}>
              {f.severity} priority
            </span>
          )}
          <span className="font-mono text-lg font-semibold tabular-nums text-text">{formatPeso(f.amountPhp)}</span>
        </div>
      </div>
      {none ? (
        <p className="text-sm text-text-muted">None this period.</p>
      ) : (
        <>
          <p className="text-sm text-text">
            <strong>What to do:</strong> {f.whatToDo}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-accent">Why it matters, and the records behind it</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-text">{f.whyItMatters}</p>
              <p className="text-xs text-text-muted">How measured: {f.howMeasured}</p>
              <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
                {f.records.map((rec, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-3 py-2">
                    <span className="min-w-0">
                      <span className="text-text">{rec.label}</span>
                      <span className="block text-xs text-text-muted">{rec.detail}</span>
                    </span>
                    <span className="font-mono tabular-nums text-text">{formatPeso(rec.amountPhp)}</span>
                  </li>
                ))}
              </ul>
              {f.count > f.records.length && (
                <p className="text-xs text-text-muted">
                  Showing the {f.records.length} largest of {f.count}.
                </p>
              )}
            </div>
          </details>
        </>
      )}
    </Surface>
  );
}

type ExportFormat = 'pdf' | 'xlsx' | 'csv';
const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'xlsx', label: 'Excel' },
  { id: 'csv', label: 'CSV' },
];

// Spreadsheets: raw numbers so cells stay summable; the summary, then one row per leak, then its records.
export function exportRows(r: LeakageReport): (string | number)[][] {
  return [
    ['Section', 'Item', 'Kind', 'Priority', 'Amount (PHP)', 'Count', 'Detail'],
    ['Summary', 'At risk this period', '', '', r.summary.atRisk.total, '', ''],
    ['Summary', 'Lost unless acted on', 'lost', '', r.summary.atRisk.lost, '', ''],
    ['Summary', 'Cash delayed', 'delayed', '', r.summary.atRisk.delayed, '', ''],
    ['Summary', 'Missed opportunity', 'opportunity', '', r.summary.atRisk.opportunity, '', ''],
    ['Summary', 'Invoiced', '', '', r.summary.invoiced, '', ''],
    ['Summary', 'Collected', '', '', r.summary.collected, '', ''],
    ...r.kpis.map((k) => ['Key figure', k.label, '', '', k.value ?? '', '', `${k.unit}; ${k.meaning}`]),
    ...r.findings.map((f) => ['Leak', f.title, f.kind, f.severity, f.amountPhp, f.count, `What to do: ${f.whatToDo} Why: ${f.whyItMatters}`]),
    ...r.findings.flatMap((f) => f.records.map((rec) => ['Record', f.title, f.kind, '', rec.amountPhp, '', `${rec.label}: ${rec.detail}`])),
  ];
}

const csvCell = (v: string | number) => (typeof v === 'number' ? String(v) : /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const today = () => manilaDate(new Date());
const monthStart = () => `${today().slice(0, 8)}01`;

function ReportsPage() {
  const toast = useToast();
  const [query, setQuery] = useState<LeakageReportQuery>({ from: monthStart(), to: today() });
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const queryClient = useQueryClient();
  const customers = useQuery(referenceQueries.customers());
  const types = useQuery(referenceQueries.equipmentTypes());
  const set = (patch: Partial<LeakageReportQuery>) => {
    setQuery((q) => ({ ...q, ...patch }));
  };

  const customerName = customers.data?.find((c) => c.id === query.customerId)?.companyName ?? 'All customers';
  const typeName = types.data?.find((t) => t.id === query.equipmentTypeId)?.name ?? 'All types';

  async function download() {
    setBusy(true);
    try {
      if (format === 'pdf') {
        const res = await apiGet<StatementPdfResponse>(`/reports/leakage/pdf?${leakageParams(query)}`);
        const bytes = Uint8Array.from(atob(res.contentBase64), (c) => c.charCodeAt(0));
        saveBlob(new Blob([bytes], { type: 'application/pdf' }), res.filename);
      } else {
        const report = await queryClient.fetchQuery(reportQueries.leakage(query));
        const rows = exportRows(report);
        const name = `revenue-leakage-${report.period.from}-to-${report.period.to}`;
        if (format === 'csv') {
          const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
          // BOM so Excel reads the file as UTF-8.
          saveBlob(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
        } else {
          const { default: writeXlsxFile } = await import('write-excel-file/browser');
          await writeXlsxFile(rows.map((r, i) => r.map((value) => (i === 0 ? { value, fontWeight: 'bold' as const } : { value })))).toFile(`${name}.xlsx`);
        }
      }
      setExporting(false);
    } catch (e) {
      toast.error('Could not generate the report', apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="Where money is leaking, what it costs, and what to do about it first."
        actions={
          <Button variant="secondary" onClick={() => setExporting(true)}>
            <FileDown className="size-4" aria-hidden /> Export
          </Button>
        }
      />
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="From" type="date" value={query.from ?? ''} max={query.to} onChange={(e) => set({ from: e.target.value })} />
        <Input label="To" type="date" value={query.to ?? ''} min={query.from} onChange={(e) => set({ to: e.target.value })} />
        <Select label="Customer" value={query.customerId ?? ''} onChange={(e) => set({ customerId: e.target.value || undefined })}>
          <option value="">All customers</option>
          {customers.data?.map((c) => (
            <option key={c.id} value={c.id}>{c.companyName}</option>
          ))}
        </Select>
        <Select label="Equipment type" value={query.equipmentTypeId ?? ''} onChange={(e) => set({ equipmentTypeId: e.target.value || undefined })}>
          <option value="">All types</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </div>
      <DataPanel
        title="Reports"
        options={reportQueries.leakage(query)}
        emptyTitle="No activity in this period"
        emptyDescription="Pick a wider date range or clear the filters."
        isEmpty={() => false}
        render={(r) => (
          <div className="flex flex-col gap-5">
            <Surface radius="md" elevation="sm" className="flex flex-col gap-3 p-5">
              <p className="text-sm font-medium text-text-muted">At risk this period</p>
              <p className="font-mono text-display-md font-semibold tabular-nums text-text">{formatPeso(r.summary.atRisk.total)}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile label="Lost unless acted on" value={formatPeso(r.summary.atRisk.lost)} hint="Earned, but never billed unless someone acts." />
                <StatTile label="Cash delayed" value={formatPeso(r.summary.atRisk.delayed)} hint="Billed or billable, not yet collected." />
                <StatTile label="Missed opportunity" value={formatPeso(r.summary.atRisk.opportunity)} hint="Machines that earned nothing; nobody owes it." />
              </div>
            </Surface>
            <section aria-labelledby="do-first" className="flex flex-col gap-2">
              <h2 id="do-first" className="text-heading-md text-text">Do these first</h2>
              {r.summary.topActions.length ? (
                <ol className="flex flex-col gap-2">
                  {r.summary.topActions.map((a, i) => (
                    <li key={a.title} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm">
                      <span className="flex flex-wrap justify-between gap-2 font-semibold text-text">
                        <span>
                          {i + 1}. {a.title}
                        </span>
                        <span className="font-mono tabular-nums">{formatPeso(a.amountPhp)}</span>
                      </span>
                      <span className="text-text-muted">{a.whatToDo}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-text-muted">No leaks found in this period. Keep recording every day and billing approved hours promptly.</p>
              )}
            </section>
            <section aria-labelledby="key-figures" className="flex flex-col gap-2">
              <h2 id="key-figures" className="text-heading-md text-text">Key figures, and what they mean</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {r.kpis.map((k) => (
                  <StatTile key={k.label} label={k.label} value={formatKpi(k) ?? 'No data'} hint={k.meaning} />
                ))}
              </div>
            </section>
            <section aria-labelledby="leaks" className="flex flex-col gap-3">
              <h2 id="leaks" className="text-heading-md text-text">Every leak, by what it costs</h2>
              <p className="text-sm text-text-muted">
                Worked out from your own bookings, time records, invoices and payments. Money lost or owed comes first, missed
                opportunity last. Open a leak for why it matters and the records behind it.
              </p>
              {r.findings.map((f, i) => (
                <FindingCard key={f.key} f={f} index={i + 1} />
              ))}
            </section>
          </div>
        )}
      />
      <Modal
        open={exporting}
        onClose={() => setExporting(false)}
        title="Export report"
        description="Uses the filters currently on the page."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExporting(false)}>Cancel</Button>
            <Button onClick={download} loading={busy}>
              <FileDown className="size-4" aria-hidden /> Download
            </Button>
          </>
        }
      >
        <SegmentedControl label="File format" items={FORMATS} value={format} onChange={setFormat} className="mb-4" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-text-muted">Period</dt>
          <dd className="text-text">{query.from || 'Start'} to {query.to || 'today'}</dd>
          <dt className="text-text-muted">Customer</dt>
          <dd className="text-text">{customerName}</dd>
          <dt className="text-text-muted">Equipment type</dt>
          <dd className="text-text">{typeName}</dd>
        </dl>
      </Modal>
    </div>
  );
}

export const appInsightsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/insights',
  component: ReportsPage,
});
