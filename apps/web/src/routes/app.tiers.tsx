import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CUSTOMER_TIERS, type TierPolicy } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { apiErrorText, apiGet, apiPut } from '../lib/api-client.js';
import { formatStatus } from '../lib/format.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { PageHeader } from '../components/page-header.js';
import { Modal } from '../components/modal.js';
import { useToast } from '../components/toast.js';
import { EditButton, SummaryCard } from '../components/summary-card.js';
import { LoadError } from '../components/load-error.js';
import { Skeleton } from '../components/skeleton.js';

const policyQuery = { queryKey: ['pricing', 'tier-policy'] as const, queryFn: () => apiGet<TierPolicy>('/pricing/tier-policy') };

function TiersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const policy = useQuery(policyQuery);
  const [draft, setDraft] = useState<TierPolicy | null>(null);
  const save = useMutation({
    mutationFn: (body: TierPolicy) => apiPut<TierPolicy>('/pricing/tier-policy', body),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: policyQuery.queryKey });
      toast.success('Tier policy saved', 'Customers move tiers at the next daily recompute or their next payment.');
    },
    onError: (err) => toast.error('Could not save the tier policy', apiErrorText(err)),
  });

  if (policy.isError) return <LoadError message={`The tier policy could not be loaded. ${apiErrorText(policy.error)}`} onRetry={() => void policy.refetch()} />;
  if (!policy.data) return <Skeleton label="Loading tier policy" />;
  const saved = policy.data;
  const minScore = (tier: (typeof CUSTOMER_TIERS)[number], p: TierPolicy) => (tier === 'bronze' ? 0 : p.thresholds[tier]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Customer tiers"
        description="Each customer's tier is scored daily from payment history, loyalty and booking behavior. The tier caps the discount staff can give; anything above it needs the Owner. A customer with an overdue balance cannot negotiate."
      />
      <SummaryCard
        title="Tiers and discount caps"
        description="New customers start at Bronze and can move up after their first paid rental."
        items={CUSTOMER_TIERS.map((tier) => ({
          label: formatStatus(tier),
          value: `score ${minScore(tier, saved)}+ · up to ${saved.capsPct[tier]}%`,
        }))}
        action={<EditButton what="tier policy" onClick={() => setDraft(saved)} />}
      />
      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title="Tiers and discount caps"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!draft} onClick={() => draft && save.mutate(draft)}>
              Save tiers
            </Button>
          </>
        }
      >
        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            {CUSTOMER_TIERS.map((tier) => (
              <fieldset key={tier} className="contents">
                {tier === 'bronze' ? (
                  <Input label="Bronze minimum score" value="0" disabled numeric hint="Every customer starts here." />
                ) : (
                  <Input
                    label={`${formatStatus(tier)} minimum score`}
                    type="number"
                    min="0"
                    max="100"
                    numeric
                    value={String(draft.thresholds[tier])}
                    onChange={(e) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [tier]: Number(e.target.value) } })}
                  />
                )}
                <Input
                  label={`${formatStatus(tier)} max discount (%)`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  numeric
                  value={String(draft.capsPct[tier])}
                  onChange={(e) => setDraft({ ...draft, capsPct: { ...draft.capsPct, [tier]: Number(e.target.value) } })}
                />
              </fieldset>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// Admin and Owner (tenant:manage server-side).
export const appTiersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/tiers',
  beforeLoad: requireRole('admin', 'owner'),
  component: TiersPage,
});
