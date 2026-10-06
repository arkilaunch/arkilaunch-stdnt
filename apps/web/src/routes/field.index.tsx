import { createRoute, Link } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldLayoutRoute } from './_field.js';
import { edtrQueries, sitesQueries } from '../lib/queries.js';
import { Button } from '../components/button.js';
import { CaptureModal } from '../components/capture-modal.js';
import { EmptyState } from '../components/empty-state.js';
import { BlankEdtrDownload } from '../components/blank-edtr-download.js';
import { formatDate, pluralize } from '../lib/format.js';
import { usePendingUploads, type QueuedCapture } from '../lib/upload-queue.js';
import { useToast } from '../components/toast.js';

function OperatorDashboardPage() {
  const queryClient = useQueryClient();
  const { data: sites, isPending: sitesPending } = useQuery(sitesQueries.list());

  const [captureOpen, setCaptureOpen] = useState(false);

  const hasSites = !!sites && sites.total > 0;
  // Only machines on site now at this timekeeper's sites (QA 32).
  const targets = useQuery({ ...edtrQueries.scanTargets(), enabled: hasSites });
  const nothingOnSite = (targets.data?.items.length ?? 0) === 0;

  // Photos saved on this phone while offline; they send themselves when the signal is back.
  const toast = useToast();
  const onRefused = useCallback(
    (items: QueuedCapture[]) => {
      for (const item of items) {
        toast.error('A saved field log was not accepted', `${formatDate(item.fields.reportDate)}: record it again.`);
      }
      void queryClient.invalidateQueries({ queryKey: ['edtr'] });
    },
    [toast, queryClient],
  );
  const pendingUploads = usePendingUploads(onRefused);

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
          {pendingUploads > 0 && (
            <p role="status" className="text-sm text-text">
              Waiting to upload ({pendingUploads}): {pluralize(pendingUploads, 'field log')} saved on this phone will send when the signal is back.
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
