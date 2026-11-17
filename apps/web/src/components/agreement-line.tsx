import type { AgreementSummary } from '@arkilaunch/shared';
import { formatDate } from '../lib/format.js';

export function AgreementLine({ agreement }: { agreement: AgreementSummary | null | undefined }) {
  if (!agreement) return <p className="text-sm text-text-muted">Rental agreement not signed yet. It is signed at checkout.</p>;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-text">
        Signed by {agreement.signedName} on {formatDate(agreement.signedAt)} · terms {agreement.termsVersion}
      </p>
      <img src={agreement.signaturePng} alt={`Signature of ${agreement.signedName}`} className="h-14 w-fit rounded-sm border border-border bg-white" />
    </div>
  );
}
