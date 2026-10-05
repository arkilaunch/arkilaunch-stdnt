import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldLayoutRoute } from './_field.js';
import { edtrQueries, sitesQueries } from '../lib/queries.js';
import { Button } from '../components/button.js';
import { CaptureModal } from '../components/capture-modal.js';
import { EmptyState } from '../components/empty-state.js';
import { BlankEdtrDownload } from '../components/blank-edtr-download.js';
import { pluralize } from '../lib/format.js';

function OperatorDashboardPage() {
  const queryClient = useQueryClient();
  const { data: sites, isPending: sitesPending } = useQuery(sitesQueries.list());

  const [captureOpen, setCaptureOpen] = useState(false);

  const hasSites = !!sites && sites.total > 0;
  // Only machines on site now at this timekeeper's sites (QA 32).
  const targets = useQuery({ ...edtrQueries.scanTargets(), enabled: hasSites });
  const nothingOnSite = (targets.data?.items.length ?? 0) === 0;

  // No pending count: the field-log queue is staff-only.

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-heading-lg text-text">Dashboard</h1>
      {sitesPending ? (
        <p className="text-sm text-text-muted">Loading your work...</p>
      ) : hasSites ? (
        <div className="flex flex-col gap-3">
          <Button
            variant="primary"
            size="field"
            className="w-full"
            disabled={nothingOnSite}
            onClick={() => setCaptureOpen(true)}
          >
            Record a field log
          </Button>
          {nothingOnSite && !targets.isPending && (
            <p className="text-sm text-text-muted">
              No machine is on site at your sites yet, so there are no hours to record.
            </p>
          )}
          <p className="text-sm text-text-muted">
            You are assigned to {pluralize(sites.total, 'site')}.
          </p>
          <Link
            to="/field/scan"
            className="min-h-12 rounded-sm border border-border bg-surface px-4 py-3 text-sm font-medium text-text"
          >
            Scan a DTR
          </Link>
          <BlankEdtrDownload />
          <Link
            to="/field/deployment"
            className="min-h-12 rounded-sm border border-border bg-surface px-4 py-3 text-sm font-medium text-text"
          >
            View deployment
          </Link>
        </div>
      ) : (
        <EmptyState
          title="No assigned sites yet"
          description="Your sites and the field logs waiting on you will appear here once you are dispatched."
        />
      )}

      <CaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onCaptured={() => {
          void queryClient.invalidateQueries({ queryKey: ['edtr'] });
        }}
        initialSource="paper_ocr"
        submitOnly
      />
    </div>
  );
}

export const fieldIndexRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field',
  component: OperatorDashboardPage,
});
