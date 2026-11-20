import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SchemaOrgBusinessType, TenantSeo, TenantSeoUpdateRequest } from '@arkilaunch/shared';
import { apiErrorText, apiPatch } from '../lib/api-client.js';
import { tenantsQueries } from '../lib/queries.js';
import { hoursLine } from '../lib/storefront-content.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { PinMap } from './pin-map.js';
import { Select } from './select.js';
import { Surface } from './surface.js';
import { useToast } from './toast.js';

const MAX_LINKS = 8;
const MAX_AREAS = 20;

const BUSINESS_TYPES: { id: SchemaOrgBusinessType; label: string }[] = [
  { id: 'LocalBusiness', label: 'Local business (equipment rental)' },
  { id: 'HomeAndConstructionBusiness', label: 'Construction business' },
  { id: 'GeneralContractor', label: 'General contractor' },
];

type Draft = Omit<TenantSeo, 'hours'>;

const toRequest = (d: Draft): TenantSeoUpdateRequest => ({
  seoTitle: d.seoTitle?.trim() || null,
  seoDescription: d.seoDescription?.trim() || null,
  businessType: d.businessType,
  serviceAreas: d.serviceAreas,
  location: d.location,
  sameAs: d.sameAs.map((u) => u.trim()).filter(Boolean),
  publishHours: d.publishHours,
});

// How the storefront home shows up in Google and AI answers. Its own save: the Details form never touches it.
export function SeoSection({ basePath, tenantName }: { basePath: string; tenantName: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const seoQuery = tenantsQueries.seo(basePath);
  const saved = useQuery(seoQuery);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [area, setArea] = useState('');
  const current: Draft | null = draft ?? saved.data ?? null;

  const save = useMutation({
    mutationFn: (d: Draft) => apiPatch<TenantSeo>(`${basePath}/seo`, toRequest(d)),
    onSuccess: (next) => {
      setDraft(null);
      queryClient.setQueryData(seoQuery.queryKey, next);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'tenant'] });
      toast.success('Search settings saved');
    },
    onError: (e) => toast.error('Could not save search settings', apiErrorText(e)),
  });

  if (saved.isError) return <p className="text-sm text-text-muted">Could not load search settings: {apiErrorText(saved.error)}</p>;
  if (!saved.data || !current) return null;

  const edit = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });
  const addArea = () => {
    const next = area.trim();
    if (!next || current.serviceAreas.length >= MAX_AREAS) return;
    if (!current.serviceAreas.some((a) => a.toLowerCase() === next.toLowerCase())) edit({ serviceAreas: [...current.serviceAreas, next] });
    setArea('');
  };
  const hours = hoursLine(saved.data.hours);
  const previewTitle = current.seoTitle?.trim() || tenantName;
  const links = current.sameAs.length < MAX_LINKS ? [...current.sameAs, ''] : current.sameAs;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (current) save.mutate(current);
  }

  return (
    <Surface radius="md" elevation="sm" className="p-4" aria-label="Search and AI visibility">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <h2 className="text-heading-md text-text">Search &amp; AI visibility</h2>
          <p className="mt-1 text-sm text-text-muted">
            How your storefront appears on Google and in AI assistants. Your public pages are open to search engines and
            AI assistants, including crawlers that train AI models. Changes reach them within about 5 minutes.
          </p>
        </div>

        <div className="rounded-sm border border-border p-3" aria-label="Search result preview">
          <p className="truncate text-base text-accent">{previewTitle}</p>
          <p className="line-clamp-2 text-sm text-text-muted">{current.seoDescription?.trim() || 'Your tagline is used until you write a description.'}</p>
        </div>

        <Input
          label="Search title"
          maxLength={70}
          value={current.seoTitle ?? ''}
          placeholder={`${tenantName} | Heavy Equipment Rental in your city`}
          onChange={(e) => edit({ seoTitle: e.target.value })}
          hint={`${(current.seoTitle ?? '').length}/70. Your company name plus what you rent and where. Leave empty to use "${tenantName} | Equipment rental in <city>".`}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="seo-description" className="text-sm font-medium text-text">
            Search description
          </label>
          <textarea
            id="seo-description"
            maxLength={160}
            rows={3}
            value={current.seoDescription ?? ''}
            onChange={(e) => edit({ seoDescription: e.target.value })}
            aria-describedby="seo-description-hint"
            className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <p id="seo-description-hint" className="text-xs text-text-muted">
            {(current.seoDescription ?? '').length}/160. One or two sentences in the words customers search with.
          </p>
        </div>

        <Select
          id="seo-business-type"
          label="Business type"
          value={current.businessType ?? ''}
          onChange={(e) => edit({ businessType: (e.target.value || null) as SchemaOrgBusinessType | null })}
          hint="How search engines classify your company."
        >
          <option value="">Local business (default)</option>
          {BUSINESS_TYPES.filter((b) => b.id !== 'LocalBusiness').map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </Select>

        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                label="Areas you serve"
                maxLength={100}
                value={area}
                placeholder="e.g. Quezon City, Bulacan, Pampanga"
                onChange={(e) => setArea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addArea();
                  }
                }}
                hint="Shown on your storefront and used for local searches."
              />
            </div>
            <Button type="button" variant="secondary" onClick={addArea} disabled={!area.trim() || current.serviceAreas.length >= MAX_AREAS}>
              Add
            </Button>
          </div>
          {current.serviceAreas.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Selected areas">
              {current.serviceAreas.map((a) => (
                <li key={a} className="flex items-center gap-1 rounded-pill border border-border px-3 py-1 text-sm text-text">
                  {a}
                  <button
                    type="button"
                    aria-label={`Remove ${a}`}
                    className="ml-1 text-text-muted hover:text-text"
                    onClick={() => edit({ serviceAreas: current.serviceAreas.filter((x) => x !== a) })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <PinMap label="Business location" value={current.location} onChange={(location) => edit({ location })} />
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>
              {current.location
                ? `Pinned at ${current.location.lat.toFixed(5)}, ${current.location.lng.toFixed(5)}`
                : 'Tap the map at your yard or office. Helps maps and local search.'}
            </span>
            {current.location && (
              <button type="button" className="underline" onClick={() => edit({ location: null })}>
                Clear pin
              </button>
            )}
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">Profile links</legend>
          <p className="text-xs text-text-muted">
            Your Google Business Profile, LinkedIn, Instagram, YouTube or TikTok page (Facebook is set above). They tell
            search engines and AI assistants these pages and this storefront are the same company.
          </p>
          {links.map((url, i) => (
            <Input
              key={i}
              label={`Profile link ${i + 1}`}
              labelHidden
              type="url"
              maxLength={300}
              value={url}
              placeholder="https://"
              onChange={(e) => {
                const next = [...links];
                next[i] = e.target.value;
                // An emptied field drops out; the trailing blank field adds the next link.
                edit({ sameAs: next.filter((u) => u !== '') });
              }}
            />
          ))}
        </fieldset>

        <label className="flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            className="mt-1"
            checked={current.publishHours}
            onChange={(e) => edit({ publishHours: e.target.checked })}
          />
          <span>
            Show business hours on the storefront
            <span className="block text-xs text-text-muted">
              {hours ? `Currently ${hours}.` : 'No hours set yet.'}{' '}
              {basePath === '/tenants/me' ? (
                <>
                  Edit them in{' '}
                  <Link to="/app/settings" className="underline">
                    Settings
                  </Link>
                  .
                </>
              ) : (
                'The company edits them in its Settings.'
              )}
            </span>
          </span>
        </label>

        <div>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!draft}>
            Save search settings
          </Button>
        </div>
      </form>
    </Surface>
  );
}
