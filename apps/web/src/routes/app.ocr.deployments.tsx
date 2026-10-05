import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appLayoutRoute } from './_app.js';
import { fieldLayoutRoute } from './_field.js';
import { edtrQueries } from '../lib/queries.js';
import { CaptureModal } from '../components/capture-modal.js';
import { DeploymentScanList } from '../components/deployment-scan-list.js';
import { PageHeader } from '../components/page-header.js';
import { Alert } from '../components/alert.js';

function DeploymentScanPage({ billingTo, submitOnly = false }: { billingTo?: string; submitOnly?: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Only bookings with a machine on site (staff also see units returned in the last 14 days).
  const targets = useQuery(edtrQueries.scanTargets());
  const error = targets.error;
  const [scanRentalId, setScanRentalId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="DTR scanning"
        description="Choose the site and machine this sheet belongs to, then scan it. A printed sheet's QR code picks them for you."
      />

      {error != null && (
        <Alert type="error">The deployment list could not be loaded, so scanning is unavailable right now.</Alert>
      )}

      <DeploymentScanList
        targets={targets.data?.items ?? []}
        onScan={(target) => setScanRentalId(target.rentalId)}
        {...(billingTo ? { onCheckBillings: () => void navigate({ to: billingTo }) } : {})}
      />

      <CaptureModal
        open={scanRentalId !== null}
        onClose={() => setScanRentalId(null)}
        {...(scanRentalId ? { initialRentalId: scanRentalId } : {})}
        initialSource="paper_ocr"
        submitOnly={submitOnly}
        onCaptured={() => {
          void queryClient.invalidateQueries({ queryKey: ['edtr'] });
        }}
      />
    </div>
  );
}

export const appOcrDeploymentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/ocr/deployments',
  component: () => <DeploymentScanPage billingTo="/app/billing/weekly" />,
});

// Same server permission (edtr:create); only the layout guard differs. Timekeepers lack edtr:read, so the
// modal must not poll the log it just sent.
export const fieldScanRoute = createRoute({
  getParentRoute: () => fieldLayoutRoute,
  path: '/field/scan',
  component: () => <DeploymentScanPage submitOnly />,
});
