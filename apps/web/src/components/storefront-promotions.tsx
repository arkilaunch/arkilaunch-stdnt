import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StorefrontPromotionsSchema, type StorefrontPromotions } from '@arkilaunch/shared';
import { apiErrorText, apiGet, apiPatch } from '../lib/api-client.js';
import { formatPeso } from '../lib/format.js';
import { Button, buttonClass } from './button.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Surface } from './surface.js';
import { useToast } from './toast.js';

const settingsKey = ['tenant-promotions'] as const;
const publicKey = ['catalog', 'promotions'] as const;
const services = ['equipment', 'trucking'] as const;
const names = { equipment: 'Equipment rental', trucking: 'Trucking services' };

export function StorefrontPromotionsForm() {
  const query = useQuery({
    queryKey: settingsKey,
    queryFn: () => apiGet<StorefrontPromotions>('/tenants/me/promotions'),
  });
  if (query.isPending) return <p role="status">Loading service promotions…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>{apiErrorText(query.error)}</p>
        <Button onClick={() => void query.refetch()}>Retry promotions</Button>
      </div>
    );
  return <PromotionEditor initial={query.data} />;
}

function PromotionEditor({ initial }: { initial: StorefrontPromotions }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const toast = useToast();
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (body: StorefrontPromotions) => apiPatch('/tenants/me/promotions', body),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: settingsKey }),
        client.invalidateQueries({ queryKey: publicKey }),
      ]);
      toast.success('Service promotions saved');
    },
    onError: (e) => {
      setError(apiErrorText(e));
      toast.error('Could not save promotions', apiErrorText(e));
    },
  });
  return (
    <Surface className="flex flex-col gap-5 p-5" aria-label="Service promotions">
      <div>
        <h2 className="text-heading-md">Service promotions</h2>
        <p className="mt-2 text-sm text-text-muted">
          Optional starting prices for your homepage. These do not change quotations or rental
          charges.
        </p>
      </div>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = StorefrontPromotionsSchema.safeParse(draft);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Check the promotion fields.');
            return;
          }
          setError('');
          save.mutate(parsed.data);
        }}
      >
        <div className="grid gap-5 md:grid-cols-2">
          {services.map((service) => {
            const item = draft[service];
            return (
              <fieldset
                key={service}
                className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-4"
              >
                <legend className="px-1 font-semibold">{names[service]}</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item !== null}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [service]: e.target.checked
                          ? {
                              enabled: true,
                              amount: 1,
                              unit: service === 'trucking' ? 'trip' : 'day',
                              qualification: '',
                            }
                          : null,
                      }))
                    }
                  />
                  Configure starting-price promotion
                </label>
                {item && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [service]: { ...item, enabled: e.target.checked },
                          }))
                        }
                      />
                      Show on homepage
                    </label>
                    <Input
                      label="Starting price (PHP)"
                      type="number"
                      required
                      min="0.01"
                      max="100000000"
                      step="0.01"
                      value={Number.isNaN(item.amount) ? '' : item.amount}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [service]: { ...item, amount: e.target.valueAsNumber },
                        }))
                      }
                    />
                    <Select
                      label="Price per"
                      value={item.unit}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [service]: { ...item, unit: e.target.value as 'hour' | 'day' | 'trip' },
                        }))
                      }
                    >
                      <option value="hour">Hour</option>
                      <option value="day">Day</option>
                      <option value="trip">Trip</option>
                    </Select>
                    <Input
                      label="Qualification"
                      hint="Explain what the starting price includes and when it applies."
                      required
                      maxLength={240}
                      value={item.qualification}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [service]: { ...item, qualification: e.target.value },
                        }))
                      }
                    />
                  </>
                )}
              </fieldset>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save service promotions
          </Button>
        </div>
      </form>
    </Surface>
  );
}

export function StorefrontServices() {
  const query = useQuery({
    queryKey: publicKey,
    queryFn: () => apiGet<StorefrontPromotions>('/catalog/promotions'),
  });
  return (
    <section aria-labelledby="services-heading" className="flex flex-col gap-7">
      <div className="max-w-2xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
          Built around your project
        </p>
        <h2 id="services-heading" className="text-display-md text-text lg:text-display-lg">
          The right equipment. The transport to match.
        </h2>
        <p className="mt-4 text-text-muted">
          Explore equipment rental and trucking services, then request a quote tailored to your site
          and schedule.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {services.map((service, index) => {
          const promotion = query.data?.[service];
          return (
            <Surface
              key={service}
              className="flex h-full flex-col gap-5 border-t-4 border-t-primary p-6 sm:p-8"
            >
              <span className="font-mono text-sm text-primary">
                0{index + 1} / {service === 'equipment' ? 'RENT' : 'TRANSPORT'}
              </span>
              <h3 className="text-heading-lg text-text">{names[service]}</h3>
              <p className="text-text-muted">
                {service === 'equipment'
                  ? 'Find machines suited to your project, with dates and support planned around your work.'
                  : 'Arrange transport for equipment and materials with a route and schedule confirmed by our team.'}
              </p>
              {promotion?.enabled && (
                <div className="rounded-card bg-primary/5 p-4">
                  <p className="text-sm text-text-muted">As low as</p>
                  <p className="mt-1 text-heading-lg text-primary">
                    {formatPeso(promotion.amount)}{' '}
                    <span className="text-sm font-normal">/ {promotion.unit}</span>
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-text">
                    {promotion.qualification}
                  </p>
                  <p className="mt-2 text-xs text-text-muted">Final price confirmed in quote.</p>
                </div>
              )}
              <div className="mt-auto pt-2">
                {service === 'equipment' ? (
                  <Link to="/equipment" className={buttonClass('primary')}>
                    Explore equipment
                  </Link>
                ) : (
                  <Link to="/account/trucks" className={buttonClass('primary')}>
                    Request trucking
                  </Link>
                )}
              </div>
            </Surface>
          );
        })}
      </div>
    </section>
  );
}
