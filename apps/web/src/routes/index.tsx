import { StorefrontServices } from '../components/storefront-promotions.js';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties } from 'react';
import { rootRoute } from './__root.js';
import { MarketingChrome } from './_public.js';
import { PlatformLanding, useScrollReveal } from './platform.index.js';
import { currentHost } from '../lib/host.js';
import { Button } from '../components/button.js';
import { EquipmentCard } from '../components/equipment-card.js';
import { useCatalogRates } from '../lib/catalog-rates.js';
import { SegmentedControl } from '../components/segmented-control.js';
import { SearchFilterBar } from '../components/search-filter-bar.js';
import { TestimonialCard } from '../components/testimonial-card.js';
import { equipmentImageUrl } from '../lib/equipment-images.js';
import { catalogQueries } from '../lib/queries.js';
import { tenantQuery } from '../lib/tenant.js';
import { getAccessToken } from '../lib/auth-client.js';
import { Skeleton } from '../components/skeleton.js';
import { LoadError } from '../components/load-error.js';
import { EmptyState } from '../components/empty-state.js';

const HOW_IT_WORKS = [
  { title: 'Browse and see prices', body: 'Every machine shows its published rate. No account needed to look.' },
  { title: 'Request a quote', body: 'Pick dates and a site. The rental team confirms the price with you.' },
  { title: 'Verify your company', body: 'Upload your company documents once. Staff check them before your first booking.' },
  { title: 'Sign and pay', body: 'Sign the rental agreement on screen and pay the deposit to lock in your dates.' },
];

function HowItWorks() {
  const [ref, visible] = useScrollReveal<HTMLElement>();
  return (
    <section ref={ref} data-scroll-reveal={visible ? 'visible' : 'hidden'} aria-labelledby="how-title" className="platform-reveal platform-reveal-group flex flex-col gap-8">
      <h2 id="how-title" className="text-display-md text-text lg:text-display-lg">How renting works</h2>
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.title} style={{ '--reveal-order': i } as CSSProperties} className="platform-reveal-item border-t border-border pt-6">
            <span className="mb-4 flex size-11 items-center justify-center rounded-pill bg-primary font-mono text-sm text-on-primary">0{i + 1}</span>
            <h3 className="text-heading-md text-text">{step.title}</h3>
            <p className="mt-3 text-sm text-text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// The first sentence of the tenant's About text, so the hero subhead is theirs when they wrote one.
export function firstSentence(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? trimmed;
}

function LandingPage() {
  const navigate = useNavigate();
  const { rateById, priceNote } = useCatalogRates();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const catalog = useQuery(catalogQueries.equipment());
  const { data: testimonialData } = useQuery(catalogQueries.testimonials());
  const tenantQ = useQuery(tenantQuery());
  const tenant = tenantQ.data;
  const signedIn = Boolean(getAccessToken());

  const available = useMemo(
    () => (catalog.data?.items ?? []).filter((eq) => eq.availabilityStatus !== 'maintenance'),
    [catalog.data],
  );
  const equipment = useMemo(
    () =>
      available.filter(
        (eq) =>
          (!category || eq.equipmentTypeName === category) &&
          `${eq.model} ${eq.equipmentTypeName}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [available, query, category],
  );
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const eq of available) counts.set(eq.equipmentTypeName, (counts.get(eq.equipmentTypeName) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [available]);

  const PREVIEW_COUNT = 6;
  const preview = equipment.slice(0, PREVIEW_COUNT);
  const firstPhoto = catalog.data?.items.find((eq) => eq.photoUri)?.photoUri;
  const heroImage = tenant?.heroUrl ?? firstPhoto;
  // Hold the hero until the tenant and fleet load, so the default tagline and a late image never flash.
  const heroReady = !tenantQ.isPending && !catalog.isPending;
  const seeAll = () => navigate({ to: '/equipment', search: query.trim() ? { q: query.trim() } : {} });

  return (
    <div className="flex flex-col gap-16 px-4 py-10 sm:px-8 lg:gap-24 lg:py-20">
      {heroReady ? (
        <section className={`grid items-center gap-10 lg:gap-16 ${heroImage ? 'lg:grid-cols-2' : ''}`}>
          <div className="flex min-w-0 flex-col gap-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-text-muted">{tenant?.name ?? 'Equipment rental'} &middot; Equipment and hauling</p>
            <h1 className="max-w-xl text-display-lg font-semibold tracking-tight text-pretty text-text lg:text-display-xl">
              {tenant?.tagline || 'Industrial equipment, ready to rent'}
            </h1>
            <p className="max-w-lg text-body-lg text-text-muted">
              {firstSentence(tenant?.about) ?? 'Browse the fleet, see the rates, pick your dates and request a quote online.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => navigate({ to: '/equipment' })}>
                Browse equipment
              </Button>
              {!signedIn && (
                <Button variant="secondary" onClick={() => navigate({ to: '/signup' })}>
                  Create account
                </Button>
              )}
            </div>
          </div>
          {heroImage && <img src={heroImage} alt="" className="aspect-[4/3] w-full rounded-lg border border-border object-cover" />}
        </section>
      ) : (
        <Skeleton label="Loading" rows={3} className="max-w-xl" />
      )}

      <StorefrontServices />

      <section className="flex flex-col gap-6">
        <h2 className="text-display-md text-text lg:text-display-lg">Available equipment</h2>
        {catalog.isPending ? (
          <Skeleton label="Loading equipment" rows={4} />
        ) : catalog.isError ? (
          <LoadError message="The equipment list could not be loaded." onRetry={() => void catalog.refetch()} />
        ) : available.length === 0 ? (
          <EmptyState title="No machines listed yet" description="The fleet is being set up. Check back soon or contact the rental team." />
        ) : (
          <>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                seeAll();
              }}
            >
              <SearchFilterBar query={query} onQueryChange={setQuery} />
            </form>
            {categories.length > 1 && (
              <SegmentedControl
                label="Category"
                value={category}
                onChange={setCategory}
                items={[{ id: '', label: 'All' }, ...categories.map(([name, n]) => ({ id: name, label: name, count: n }))]}
              />
            )}
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {preview.map((eq) => {
                const imageUrl = eq.photoUri ?? equipmentImageUrl(eq.model);
                return (
                  <EquipmentCard
                    key={eq.id}
                    showPrice={false}
                    rateValue={rateById.get(eq.id) ?? null}
                    priceNote={priceNote}
                    imageAlt={`${eq.equipmentTypeName} ${eq.model}`}
                    {...(imageUrl ? { imageUrl } : {})}
                    model={eq.model}
                    make={eq.equipmentTypeName}
                    equipmentId={eq.id}
                    onRent={() => navigate({ to: '/equipment/$equipmentId', params: { equipmentId: eq.id } })}
                  />
                );
              })}
              {equipment.length === 0 && (
                <p className="col-span-full py-12 text-center text-sm text-text-muted">No equipment matches &quot;{query}&quot;.</p>
              )}
            </div>
            {equipment.length > PREVIEW_COUNT && (
              <div>
                <Button variant="secondary" onClick={seeAll}>
                  See all {equipment.length} machines
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <HowItWorks />

      {testimonialData && testimonialData.items.length > 0 && (
        <section id="testimonials" className="flex scroll-mt-20 flex-col gap-6">
          <h2 className="text-display-md text-text lg:text-display-lg">Testimonials</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {testimonialData.items.map((t) => (
              <TestimonialCard key={t.id} testimonial={t} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function HomePage() {
  if (currentHost.kind === 'platform') return <PlatformLanding />;
  return (
    <MarketingChrome>
      <LandingPage />
    </MarketingChrome>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});
