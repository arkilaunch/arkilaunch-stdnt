import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { IncidentResponse, IncidentStatus } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { incidentsQueries, usersQueries } from '../lib/queries.js';
import { apiPatch } from '../lib/api-client.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Table, type TableColumn } from '../components/table.js';
import { PAGE_SIZE, Pagination } from '../components/pagination.js';
import { Tabs } from '../components/tabs.js';
import { Modal } from '../components/modal.js';
import { Button, buttonClass } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { useToast } from '../components/toast.js';
import { formatDateTime, formatSeverity, shortCode } from '../lib/format.js';
import { CircleCheck, CloudRain, Eye, FileWarning, ShieldAlert, TriangleAlert } from 'lucide-react';

const KIND_META = {
  weather: { label: 'Weather', icon: CloudRain },
  discrepancy: { label: 'Log mismatch', icon: FileWarning },
  used_despite_warning: { label: 'Used during warning', icon: ShieldAlert },
} as const;

const STATUS_LABEL: Record<IncidentStatus, string> = { open: 'Open', acknowledged: 'Acknowledged', dismissed: 'Dismissed' };

const SOURCE_LABEL = {
  sheet: 'Field log: the timekeeper marked heavy rain, strong wind or a storm signal',
  system: 'System: the machine was under a stop-work weather warning',
} as const;

function IncidentKind({ kind }: { kind: IncidentResponse['kind'] }) {
  const { icon: Icon, label } = KIND_META[kind];
  return <span className="inline-flex items-center gap-2 font-medium text-text"><Icon className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />{label}</span>;
}

function IncidentSeverity({ severity }: { severity: string | null }) {
  const Icon = severity === 'none' ? CircleCheck : severity === 'watch' ? Eye : severity === 'stop_work' ? ShieldAlert : TriangleAlert;
  const tone = severity === 'none' ? 'text-success' : severity === 'stop_work' || severity === 'warning' ? 'text-error' : 'text-warning';
  return <span className="inline-flex items-center gap-1.5 text-text"><Icon className={`h-4 w-4 ${tone}`} aria-hidden="true" />{formatSeverity(severity)}</span>;
}

const COLUMNS: TableColumn<IncidentResponse>[] = [
  { header: 'Incident', kind: 'text', cell: (row) => <IncidentKind kind={row.kind} /> },
  { header: 'Company', kind: 'text', cell: (row) => row.customerName ?? '—' },
  { header: 'Severity', kind: 'status', cell: (row) => <IncidentSeverity severity={row.severity} /> },
  { header: 'Status', kind: 'status', cell: (row) => STATUS_LABEL[row.status] },
  { header: 'Occurred', kind: 'date', cell: (row) => formatDateTime(row.occurredAt) },
  {
    header: 'Details', kind: 'text',
    cell: (row) => <p className="line-clamp-2 max-w-md break-words text-text">{detailText(row)}</p>,
  },
  { header: 'Project site', kind: 'text', cell: siteLabel },
];

const detailText = (row: IncidentResponse) => row.detail ?? 'Weather advisory crossed at this site';

function siteLabel(row: IncidentResponse) {
  const place = [row.siteCity, row.siteProvince].filter(Boolean).join(', ');
  if (place) return place;
  return row.projectSiteId ? `Unnamed site ${shortCode('site', row.projectSiteId)}` : 'Not linked to a site';
}

const humanKey = (key: string) =>
  key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join('; ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(new Date(value));
  return String(value);
}

// A person's call on the incident; it never changes a bill or a deposit (RFC-2).
function ReviewForm({ incident }: { incident: IncidentResponse }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [note, setNote] = useState(incident.reviewNote ?? '');
  const [saving, setSaving] = useState(false);
  const needsNote = status === 'dismissed' && !note.trim();

  async function save() {
    setSaving(true);
    try {
      await apiPatch(`/incidents/${incident.id}`, { status, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success('Incident updated', `Marked ${STATUS_LABEL[status].toLowerCase()}.`);
      await queryClient.invalidateQueries({ queryKey: ['incidents'] });
    } catch {
      toast.error('Could not update the incident', 'Try again in a moment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)}>
        {Object.entries(STATUS_LABEL).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>
      <Input
        label="Note"
        value={note}
        maxLength={1000}
        onChange={(e) => setNote(e.target.value)}
        hint="Required to dismiss: say why it is not a finding."
        error={needsNote ? 'Add a note to dismiss this incident.' : undefined}
      />
      <div>
        <Button onClick={() => void save()} disabled={saving || needsNote}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function IncidentDrawer({ incident, onClose }: { incident: IncidentResponse; onClose: () => void }) {
  const me = useQuery(usersQueries.me());
  // The same people who decide a field log decide its incident.
  const canReview = me.data?.role === 'admin' || me.data?.role === 'platform_admin';
  const observed =
    incident.observed && typeof incident.observed === 'object' && !Array.isArray(incident.observed)
      ? Object.entries(incident.observed as Record<string, unknown>).filter(([, v]) => v !== undefined)
      : [];
  const rows: [string, ReactNode][] = [
    ['Incident', <IncidentKind key="k" kind={incident.kind} />],
    ['Company', incident.customerName ?? '—'],
    ...(incident.source ? [['Flagged by', SOURCE_LABEL[incident.source]] as [string, ReactNode]] : []),
    ['Severity', <IncidentSeverity key="s" severity={incident.severity} />],
    ['Status', STATUS_LABEL[incident.status]],
    ...(incident.reviewNote ? [['Review note', incident.reviewNote] as [string, ReactNode]] : []),
    ...(incident.reviewedAt ? [['Reviewed', formatDateTime(incident.reviewedAt)] as [string, ReactNode]] : []),
    ['Occurred', formatDateTime(incident.occurredAt)],
    ['Project site', siteLabel(incident)],
    ['Details', detailText(incident)],
    ...observed.map(([k, v]): [string, ReactNode] => [humanKey(k), formatValue(v)]),
  ];
  return (
    <Modal
      open
      onClose={onClose}
      placement="right"
      size="lg"
      title="Incident details"
      footer={
        incident.edtrId ? (
          // The sheet, its parsed hours and its AM/PM weather check, read-only.
          <Link to="/app/ocr" search={{ log: incident.edtrId }} className={buttonClass('secondary')}>
            Open field log
          </Link>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] [&_dd]:[overflow-wrap:anywhere] gap-x-4 gap-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-text-muted">{label}</dt>
            <dd className="break-words text-text">{value}</dd>
          </div>
        ))}
      </dl>
      {canReview && <ReviewForm key={incident.id} incident={incident} />}
    </Modal>
  );
}

// Who keeps running machines through bad weather; picking one filters the log to that company.
function CompanyTally({ selected, onSelect }: { selected: string | undefined; onSelect: (customerId: string | undefined) => void }) {
  const tally = useQuery(incidentsQueries.companies());
  const items = tally.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="company-tally" className="flex flex-col gap-2">
      <h2 id="company-tally" className="text-sm font-medium text-text-muted">Used during warning, by company</h2>
      <div className="flex flex-wrap gap-2">
        {selected && (
          <button type="button" className={buttonClass('ghost')} onClick={() => onSelect(undefined)}>
            All companies
          </button>
        )}
        {items.map((c) => (
          <button
            key={c.customerId}
            type="button"
            aria-pressed={selected === c.customerId}
            className={buttonClass(selected === c.customerId ? 'primary' : 'secondary')}
            onClick={() => onSelect(selected === c.customerId ? undefined : c.customerId)}
          >
            {c.companyName}: {c.total} ({c.open} open)
          </button>
        ))}
      </div>
    </section>
  );
}

type Kind = 'all' | 'weather' | 'used_despite_warning';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'weather', label: 'Weather' },
  { id: 'used_despite_warning', label: 'Used despite warning' },
];

function IncidentsPage() {
  const { open } = appIncidentsRoute.useSearch();
  const navigate = useNavigate({ from: '/app/incidents' });
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState<Kind>('all');
  const [customerId, setCustomerId] = useState<string | undefined>();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Incidents"
        description="Weather and liability events recorded against your sites."
      />
      <CompanyTally
        selected={customerId}
        onSelect={(next) => {
          setCustomerId(next);
          setOffset(0);
        }}
      />
      <Tabs
        label="Filter incidents"
        items={KINDS}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setOffset(0);
        }}
      />
      <DataPanel
        title="Incidents"
        options={incidentsQueries.list(PAGE_SIZE, offset, kind === 'all' ? undefined : kind, customerId)}
        emptyTitle="No incidents logged"
        emptyDescription="Weather and liability incidents will appear here as they are auto-logged or recorded."

        isEmpty={(data) => data.total === 0}
        render={(data) => {
          // ponytail: resolves from the loaded page only; a link to an incident on another page shows nothing.
          const selected = open ? data.items.find((row) => row.id === open) : undefined;
          return (
            <>
              <Table
                columns={COLUMNS}
                rows={data.items}
                rowKey={(row) => row.id}
                onRowClick={(row) => void navigate({ search: { open: row.id } })}
                header={{ title: 'Incidents', count: data.total, pagination: <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} onOffsetChange={setOffset} noun="incidents" /> }}
              />
              {selected && <IncidentDrawer incident={selected} onClose={() => void navigate({ search: {} })} />}
            </>
          );
        }}
      />
    </div>
  );
}

export const appIncidentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/incidents',
  validateSearch: (search: Record<string, unknown>): { open?: string } =>
    typeof search.open === 'string' ? { open: search.open } : {},
  component: IncidentsPage,
});
