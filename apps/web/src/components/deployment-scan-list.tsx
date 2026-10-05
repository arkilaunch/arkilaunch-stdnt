import { useMemo, useState } from 'react';
import type { ScanTarget } from '@arkilaunch/shared';
import { pluralize } from '../lib/format.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { Surface } from './surface.js';
import { PAGE_SIZE, Pagination } from './pagination.js';
import { SearchField } from './search-field.js';

export interface DeploymentScanListProps {
  targets: ScanTarget[];
  onScan: (target: ScanTarget) => void;
  onCheckBillings?: (target: ScanTarget) => void;
}

const haystack = (t: ScanTarget) =>
  [t.siteName, t.customerName, t.bookingCode, ...t.units.flatMap((u) => [u.name, u.serialNo])].join(' ').toLowerCase();

// QA 32: one row per site booking with the machines on site, so the sheet goes to the exact site and unit.
export function DeploymentScanList({ targets, onScan, onCheckBillings }: DeploymentScanListProps) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return targets;
    return targets.filter((t) => haystack(t).includes(needle));
  }, [targets, search]);

  if (targets.length === 0) {
    return (
      <EmptyState
        title="No machine is on site"
        description="A site appears here once a machine is delivered to it, and that machine's daily sheets can be scanned."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchField
        id="deployment-search"
        className="max-w-md"
        label="Search deployments"
        value={search}
        onChange={(next) => {
          setSearch(next);
          setOffset(0);
        }}
        placeholder="Site, client, machine or serial"
      />

      {matches.length === 0 ? (
        <p className="text-sm text-text-muted">No deployment matches "{search}".</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {matches.slice(offset, offset + PAGE_SIZE).map((target) => (
              <li key={target.rentalId}>
                <Surface
                  radius="md"
                  elevation="sm"
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium text-text">{target.siteName}</span>
                    <span className="text-sm text-text-muted">
                      {target.customerName ?? 'Unnamed customer'} · <span className="font-mono">{target.bookingCode ?? '--'}</span>
                    </span>
                    <span className="text-sm text-text-muted">
                      {pluralize(target.units.length, 'machine')}: {target.units.map((u) => `${u.name} (${u.serialNo})${u.onSite ? '' : ', returned'}`).join('; ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {onCheckBillings && (
                      <Button
                        variant="secondary"
                        size="field"
                        onClick={() => onCheckBillings(target)}
                      >
                        Check billings
                      </Button>
                    )}
                    <Button variant="primary" size="field" onClick={() => onScan(target)}>
                      Scan DTR
                    </Button>
                  </div>
                </Surface>
              </li>
            ))}
          </ul>
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            total={matches.length}
            onOffsetChange={setOffset}
            noun="deployments"
          />
        </>
      )}
    </div>
  );
}
