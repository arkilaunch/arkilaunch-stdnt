import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Menu,
  Mail,
  MapPin,
  Phone,
  Store,
  X,
  MessageCircle,
  Send,
} from 'lucide-react';
import { CatalogTenantListResponseSchema, type CatalogTenantListItem } from '@arkilaunch/shared';
import { Button } from '../components/button.js';
import { Select } from '../components/select.js';
import { SkipLink } from '../components/skip-link.js';
import { EmptyState } from '../components/empty-state.js';
import { LoadError } from '../components/load-error.js';
import { Pagination } from '../components/pagination.js';
import { apiGet } from '../lib/api-client.js';
import { onPrimaryFor } from '../lib/brand.js';
import { tenantOrigin } from '../lib/host.js';

import { SearchField } from '../components/search-field.js';
import { SegmentedControl } from '../components/segmented-control.js';
import { messengerHrefs } from '../components/messenger-links.js';
const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN ?? 'arkilaunch.app';
// ponytail: placeholder contact until the real inbox and line exist; set them per env.
const CONTACT_EMAIL = import.meta.env.VITE_PLATFORM_CONTACT_EMAIL || `hello@${PLATFORM_DOMAIN}`;
const CONTACT_PHONE = import.meta.env.VITE_PLATFORM_CONTACT_PHONE;

function toLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(() =>
    typeof IntersectionObserver === 'undefined' ||
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true),
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.unobserve(element);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -5% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  return [ref, visible] as const;
}

const FEATURES: { title: string; body: string }[] = [
  { title: 'Know your fleet', body: 'See what is available, deployed or due for maintenance. Keep your equipment and dispatch records together.' },
  { title: 'Prepare the next quote', body: 'Bring your rate cards, diesel prices and transport costs into a quotation you can review and send.' },
  { title: 'Bring field hours into focus', body: 'Capture digital or paper time reports. Compare independent logs, review differences and approve the hours.' },
  { title: 'Keep billing connected', body: 'Trace statements, deposits and payments back to reconciled hours. A person approves before a deposit deduction.' },
];

const STEPS = [
  { title: 'Register your company', body: 'Create your account and submit your company documents for review.' },
  { title: 'Complete review and activation', body: 'Follow the activation email to set your password. Company documents are checked during review.' },
  { title: 'Make it your own', body: 'Add your fleet, configure your rates and set up your branded storefront.' },
];

// Editorial selection; membership and branding still come from the active public catalog.
const FEATURED_PARTNERS = [{ slug: 'almara', query: 'Almara', label: 'Pilot partner' }];

function CompanyLogo({ t, large = false }: { t: CatalogTenantListItem; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = large ? 'size-20' : 'size-14';
  const brand = t.primaryColor ? { backgroundColor: t.primaryColor, color: onPrimaryFor(t.primaryColor) } : undefined;
  return t.logoUrl && !failed ? (
    <img src={t.logoUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className={`${size} shrink-0 object-contain`} />
  ) : (
    <span aria-hidden="true" style={brand} className={`${size} flex shrink-0 items-center justify-center rounded-md bg-primary text-heading-lg text-on-primary`}>
      {t.name.split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join('')}
    </span>
  );
}

function FeaturedPartner({ partner }: { partner: (typeof FEATURED_PARTNERS)[number] }) {
  const { data } = useQuery({
    queryKey: ['catalog', 'featured-partner', partner.slug],
    queryFn: async () => CatalogTenantListResponseSchema.parse(await apiGet<unknown>(`/catalog/tenants?q=${encodeURIComponent(partner.query)}&limit=100`)),
    retry: false,
  });
  const t = data?.items.find((item) => item.slug === partner.slug);
  if (!t) return null;
  return (
    <article className="grid gap-8 rounded-lg border border-border bg-surface p-6 sm:p-8 lg:grid-cols-[1fr_1.3fr] lg:items-center">
      <div className="flex items-center gap-5">
        <CompanyLogo key={t.logoUrl} t={t} large />
        <div className="min-w-0">
          <p className="mb-2 text-sm font-medium text-accent">{partner.label}</p>
          <h3 className="text-heading-lg text-text">{t.name}</h3>
          {[t.city, t.province].filter(Boolean).length > 0 && <p className="mt-2 text-sm text-text-muted">{[t.city, t.province].filter(Boolean).join(', ')}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:border-l lg:border-border lg:pl-8">
        <p className="text-body-lg text-text">A rental company. Its own identity.</p>
        <p className="text-sm text-text-muted">{t.tagline || `${t.name} is ArkiLaunch's pilot rental partner. Explore its fleet and start a rental enquiry through its own storefront.`}</p>
        {t.categories.length > 0 && <p className="text-sm text-text-muted">Equipment: {t.categories.slice(0, 3).join(', ')}</p>}
        <a href={tenantOrigin(t.slug)} className="inline-flex min-h-11 items-center gap-2 self-start font-medium text-accent hover:underline">
          Visit {t.name}’s storefront <ArrowRight aria-hidden className="size-4" />
        </a>
      </div>
    </article>
  );
}

function Partners() {
  const [ref, visible] = useScrollReveal<HTMLElement>();
  return (
    <section ref={ref} data-scroll-reveal={visible ? 'visible' : 'hidden'} id="partners" aria-labelledby="partners-title" className="platform-reveal flex scroll-mt-24 flex-col gap-8">
      <div className="max-w-2xl">
        <p className="mb-3 text-sm font-medium text-accent">Rental partners</p>
        <h2 id="partners-title" className="text-display-md text-text lg:text-display-lg">Their fleet. Their brand. Connected by ArkiLaunch.</h2>
        <p className="mt-4 text-body-lg text-text-muted">Looking for equipment? Meet the rental companies on the platform. Browse and book through each company’s own storefront.</p>
      </div>
      {FEATURED_PARTNERS.map((partner) => <FeaturedPartner key={partner.slug} partner={partner} />)}
      <Directory />
    </section>
  );
}

// `/` is also the tenant home, so the search is read loosely, not via validateSearch.
type DirectorySearch = { q?: string | undefined; category?: string | undefined; location?: string | undefined; page?: number | undefined };
const DIRECTORY_PAGE = 9;

function readSearch(raw: Record<string, unknown>): DirectorySearch {
  const out: DirectorySearch = {};
  for (const k of ['q', 'category', 'location'] as const) {
    const v = raw[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  // A number, not a string: the router JSON-quotes numeric strings (?page=%222%22).
  const page = Number(raw.page);
  if (Number.isInteger(page) && page > 1) out.page = page;
  return out;
}

function CompanyCard({ t }: { t: CatalogTenantListItem }) {
  const place = [t.city, t.province].filter(Boolean).join(', ');
  const href = tenantOrigin(t.slug);
  const brand = t.primaryColor ? { backgroundColor: t.primaryColor, color: onPrimaryFor(t.primaryColor) } : undefined;
  const more = t.categories.length - 3;
  return (
    <a
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface transition duration-200 hover:-translate-y-1 hover:shadow-md focus-visible:-translate-y-1 focus-visible:shadow-md"
    >
      <span aria-hidden="true" className="h-1 shrink-0 bg-primary" style={brand} />
      <span className="flex flex-1 flex-col gap-4 p-5">
        <span className="flex gap-4">
          <CompanyLogo key={t.logoUrl} t={t} />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-heading-md text-text">{t.name}</span>
            {t.tagline && <span className="text-sm text-text-muted">{t.tagline}</span>}
            {place && (
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <MapPin aria-hidden className="size-3.5 shrink-0" />
                {place}
              </span>
            )}
          </span>
        </span>
        {t.categories.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            <span className="sr-only">Rents out:</span>
            {t.categories.slice(0, 3).map((c) => (
              <span key={c} className="rounded-xs border border-border px-2 py-0.5 font-mono text-xs text-text-muted">
                {c}
              </span>
            ))}
            {more > 0 && (
              <span className="rounded-xs border border-border px-2 py-0.5 font-mono text-xs text-text-muted">+{more}</span>
            )}
          </span>
        )}
      </span>
      <span className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm transition group-hover:bg-surface-sunk">
        <span className="min-w-0 truncate font-mono text-xs text-text-muted">{new URL(href).host}</span>
        <span className="flex shrink-0 items-center gap-1 font-medium text-accent">
          Visit storefront
          <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </a>
  );
}

function Directory() {
  const navigate = useNavigate();
  const section = useRef<HTMLElement>(null);
  const search = readSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const page = search.page ?? 1;
  const offset = (page - 1) * DIRECTORY_PAGE;
  const [q, setQ] = useState(search.q ?? '');
  const query = new URLSearchParams({ limit: String(DIRECTORY_PAGE), offset: String(offset) });
  for (const k of ['q', 'category', 'location'] as const) if (search[k]) query.set(k, search[k]);
  const params = query.toString();
  const { data, isPending, isError, isPlaceholderData, refetch } = useQuery({
    queryKey: ['catalog', 'tenants', params] as const,
    queryFn: async () => CatalogTenantListResponseSchema.parse(await apiGet<unknown>(`/catalog/tenants?${params}`)),
    placeholderData: keepPreviousData,
  });

  // resetScroll: false, or every keystroke would jump to the top.
  function apply(next: DirectorySearch) {
    void navigate({
      to: '/',
      // From the live URL, not this render's copy: the debounced q timer fires later.
      search: ((prev: Record<string, unknown>) => readSearch({ ...prev, page: undefined, ...next })) as never,
      replace: true,
      resetScroll: false,
    });
  }

  useEffect(() => {
    const next = q.trim();
    if (next === (search.q ?? '')) return;
    const timer = setTimeout(() => apply({ q: next }), 300);
    return () => clearTimeout(timer);
  }, [q]);

  function clearAll() {
    setQ('');
    void navigate({ to: '/', search: {} as never, replace: true, resetScroll: false });
  }

  const applied = [
    search.q && {
      label: `“${search.q}”`,
      clear: () => {
        setQ('');
        apply({ q: '' });
      },
    },
    search.category && { label: search.category, clear: () => apply({ category: '' }) },
    search.location && { label: search.location, clear: () => apply({ location: '' }) },
  ].filter((f): f is { label: string; clear: () => void } => Boolean(f));

  const categories = data?.categories ?? [];
  const locations = data?.locations ?? [];
  const total = data?.total ?? 0;
  return (
    <section ref={section} aria-labelledby="directory-title" className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 id="directory-title" className="text-heading-lg text-text">
          Find a rental company
        </h3>
        <p className="text-body-lg text-text-muted">Explore active rental companies and visit their storefronts.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_16rem] sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="directory-q" className="text-sm font-medium text-text">
              Company name
            </label>
            <SearchField id="directory-q" size="default" value={q} onChange={setQ} maxLength={100} label="Company name" placeholder="Search by name" />
          </div>
          <Select label="City" value={search.location ?? ''} onChange={(e) => apply({ location: e.target.value })}>
            <option value="">Any city</option>
            {locations.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {search.location && !locations.includes(search.location) && (
              <option value={search.location}>{search.location}</option>
            )}
          </Select>
        </div>

        <SegmentedControl
          className="[&_button]:min-h-11"
          label="Equipment"
          value={search.category ?? ''}
          onChange={(category) => apply({ category })}
          items={['', ...categories].map((c) => ({ id: c, label: c || 'All equipment' }))}
        />

        <div className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
          <p aria-live="polite" className="mr-2 font-medium text-text">
            {isPending ? 'Searching…' : `${total} ${total === 1 ? 'company' : 'companies'}`}
          </p>
          {applied.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={f.clear}
              aria-label={`Remove filter ${f.label}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-border bg-surface-sunk px-3 text-text hover:border-border-strong"
            >
              {f.label}
              <X aria-hidden className="size-4" />
            </button>
          ))}
          {applied.length > 0 && (
            <button type="button" onClick={clearAll} className="min-h-11 rounded-sm px-2 font-medium text-accent hover:underline">
              Clear all
            </button>
          )}
        </div>
      </div>

      {isError ? (
        <LoadError message="The directory could not be loaded. Check your connection and try again." onRetry={() => void refetch()} />
      ) : isPending ? (
        <div role="status" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <span className="sr-only">Loading companies</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} aria-hidden="true" className="h-48 animate-pulse rounded-md bg-border/60" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          title="No rental companies match"
          description="Try another name or city, or show every kind of equipment."
          action={
            applied.length > 0 ? (
              <Button variant="secondary" onClick={clearAll}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul
            key={`${offset}:${data.items.map((t) => t.slug).join()}`}
            className={['grid gap-6 transition-opacity sm:grid-cols-2 lg:grid-cols-3', isPlaceholderData ? 'opacity-60' : ''].join(' ')}
          >
            {data.items.map((t, i) => (
              <li key={t.slug} className="animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
                <CompanyCard t={t} />
              </li>
            ))}
          </ul>
          <Pagination
            offset={offset}
            limit={DIRECTORY_PAGE}
            total={total}
            noun="companies"
            busy={isPlaceholderData}
            onOffsetChange={(next) => {
              const n = next / DIRECTORY_PAGE + 1;
              apply({ page: n });
              section.current?.scrollIntoView({ block: 'start' });
            }}
          />
        </>
      )}
    </section>
  );
}

function AddressPreview() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const label = toLabel(name) || 'yourcompany';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      sessionStorage.setItem('arkilaunch.registrationCompanyName', name.trim());
    } catch {
      // Private mode: the company name is simply typed again on step 2.
    }
    void navigate({ to: '/register' });
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-md sm:p-8">
      <h2 className="text-heading-lg text-text">Your storefront address</h2>
      <p className="truncate font-mono text-sm text-text-muted" aria-live="polite">
        https://<strong className="text-text">{label}</strong>.{PLATFORM_DOMAIN}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="company-name">
          Your company name
        </label>
        <input
          id="company-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your company name"
          maxLength={200}
          className="min-h-11 flex-1 rounded-input border border-border bg-surface px-4 text-text"
        />
        <Button type="submit">Start registration</Button>
      </div>
    </form>
  );
}

function Features() {
  const [ref, visible] = useScrollReveal<HTMLElement>();
  return (
    <section ref={ref} data-scroll-reveal={visible ? 'visible' : 'hidden'} id="product" aria-labelledby="features-title" className="platform-reveal platform-reveal-group flex scroll-mt-24 flex-col gap-8">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-end">
        <div>
          <p className="mb-3 text-sm font-medium text-accent">From the yard to the office</p>
          <h2 id="features-title" className="text-display-md text-text lg:text-display-lg">One place for the work behind every rental.</h2>
        </div>
        <p className="max-w-lg text-body-lg text-text-muted lg:justify-self-end">Keep the fleet, the field and your records connected, so your team can follow a rental from quotation to billing.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <article key={f.title} style={{ '--reveal-order': i } as CSSProperties} className="platform-reveal-item flex flex-col gap-8 rounded-md border border-border bg-surface p-6">
            <div className="flex justify-end">
              <span aria-hidden className="font-mono text-xs text-text-muted">0{i + 1}</span>
            </div>
            <div><h3 className="text-heading-md text-text">{f.title}</h3><p className="mt-3 text-sm text-text-muted">{f.body}</p></div>
          </article>
        ))}
      </div>
      <div className="flex flex-col gap-4 rounded-md border border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><Store aria-hidden className="mt-1 size-5 shrink-0 text-accent" /><p className="text-sm text-text-muted"><span className="font-medium text-text">Your business, at your own address.</span> Give customers a branded storefront to browse your fleet and request a rental.</p></div>
        <a href="#getting-started" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-accent hover:underline">See how to get started <ArrowRight aria-hidden className="size-4" /></a>
      </div>
    </section>
  );
}

function GettingStarted() {
  const [ref, visible] = useScrollReveal<HTMLElement>();
  return (
    <section ref={ref} data-scroll-reveal={visible ? 'visible' : 'hidden'} id="getting-started" aria-labelledby="how-title" className="platform-reveal platform-reveal-group flex scroll-mt-24 flex-col gap-8">
      <div className="max-w-2xl"><p className="mb-3 text-sm font-medium text-accent">Getting started</p><h2 id="how-title" className="text-display-md text-text lg:text-display-lg">Bring your rental business online.</h2><p className="mt-4 text-body-lg text-text-muted">Start with your company details. Build your workspace around the way your team already works.</p></div>
      <ol className="grid gap-6 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} style={{ '--reveal-order': i } as CSSProperties} className="platform-reveal-item border-t border-border pt-6">
            <span className="mb-4 flex size-11 items-center justify-center rounded-pill bg-primary font-mono text-sm text-on-primary">0{i + 1}</span>
            <h3 className="text-heading-md text-text">{s.title}</h3><p className="mt-3 text-sm text-text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <AddressPreview />
    </section>
  );
}

function ClosingCta() {
  const navigate = useNavigate();
  const [ref, visible] = useScrollReveal<HTMLElement>();
  const link = 'inline-flex min-h-11 items-center gap-3 rounded-sm text-base hover:underline';
  return (
    <section
      ref={ref}
      data-scroll-reveal={visible ? 'visible' : 'hidden'}
      id="contact"
      aria-labelledby="cta-title"
      className="platform-reveal grid gap-10 rounded-lg bg-nav p-8 text-text-inverse lg:grid-cols-[3fr_2fr] lg:items-center lg:p-12"
    >
      <div className="flex flex-col gap-5">
        <h2 id="cta-title" className="text-display-md lg:text-display-lg">
          Ready to bring your rentals together?
        </h2>
        <p className="max-w-xl text-body-lg text-text-inverse/70">
          Start your company registration and take the next step toward a connected fleet, back office and storefront.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => navigate({ to: '/register' })}>Register your company</Button>
          <Link to="/login" className="inline-flex min-h-11 items-center rounded-sm px-3 text-sm hover:bg-current/10">
            Sign in
          </Link>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-current/15 pt-8 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
        <h3 className="text-heading-md">Talk to us</h3>
        <p className="text-sm text-text-inverse/70">Questions about pricing, setup or moving your fleet over.</p>
        <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
          <Mail aria-hidden className="size-5 text-primary" />
          {CONTACT_EMAIL}
        </a>
        {CONTACT_PHONE && (
          <a href={`tel:${CONTACT_PHONE.replace(/\s+/g, '')}`} className={link}>
            <Phone aria-hidden className="size-5 text-primary" />
            {CONTACT_PHONE}
          </a>
        )}
        {(() => {
          const hrefs = messengerHrefs(CONTACT_PHONE);
          return hrefs && (
            <>
              <a href={hrefs.viber} className={link}><MessageCircle aria-hidden className="size-5 text-primary" />Viber</a>
              <a href={hrefs.telegram} target="_blank" rel="noreferrer" className={link}><Send aria-hidden className="size-5 text-primary" />Telegram</a>
            </>
          );
        })()}
      </div>
    </section>
  );
}

const navLink = 'inline-flex min-h-11 items-center rounded-sm px-3 text-sm hover:bg-current/10';
const registerLink = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-pill bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover';

export function PlatformChrome({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  function closeMenu() { setMenuOpen(false); }
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SkipLink />
      <header className="sticky top-0 z-50 bg-nav text-text-inverse" onKeyDown={(e) => { if (e.key === 'Escape' && menuOpen) { closeMenu(); menuButton.current?.focus(); } }}>
        <div className="mx-auto flex min-h-18 w-full max-w-shell items-center justify-between gap-4 px-4 sm:px-8">
          <Link to="/" onClick={closeMenu} className="inline-flex min-h-11 shrink-0 items-center text-heading-md">ArkiLaunch</Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            <a href="/#product" className={navLink}>Product</a><a href="/#partners" className={navLink}>Partners</a><a href="/#contact" className={navLink}>Contact</a>
            <Link to="/login" className={navLink}>Sign in</Link><Link to="/register" className={`${registerLink} ml-3`}>Register your company</Link>
          </nav>
          <button ref={menuButton} type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="platform-mobile-nav" onClick={() => setMenuOpen(!menuOpen)} className="flex size-11 items-center justify-center rounded-sm hover:bg-current/10 md:hidden">{menuOpen ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}</button>
        </div>
        <nav id="platform-mobile-nav" aria-label="Mobile primary" hidden={!menuOpen} className="border-t border-current/15 px-4 pb-5 md:hidden">
          <div className="flex flex-col items-stretch" onClick={closeMenu}>
            <a href="/#product" className={navLink}>Product</a><a href="/#partners" className={navLink}>Partners</a><a href="/#contact" className={navLink}>Contact</a><Link to="/login" className={navLink}>Sign in</Link><Link to="/register" className={`${registerLink} mt-2`}>Register your company</Link>
          </div>
        </nav>
      </header>
      {children}
      <footer className="bg-nav text-text-inverse">
        <div className="mx-auto grid max-w-shell gap-8 px-4 py-10 sm:px-8 md:grid-cols-[1fr_auto]">
          <div><Link to="/" className="inline-flex min-h-11 items-center text-heading-md">ArkiLaunch</Link><p className="mt-2 max-w-sm text-sm text-text-inverse/80">Equipment rental management for the companies that keep construction moving.</p></div>
          <nav aria-label="Footer" className="flex flex-wrap items-start gap-x-5"><Link to="/help" className={navLink}>Help</Link><Link to="/terms" className={navLink}>Terms</Link><Link to="/privacy" className={navLink}>Privacy</Link><a href="/#contact" className={navLink}>Contact</a></nav>
          <p className="border-t border-current/15 pt-6 text-xs text-text-inverse/80 md:col-span-2">© {new Date().getFullYear()} ArkiLaunch</p>
        </div>
      </footer>
    </div>
  );
}

function ProductPreview() {
  return (
    <figure className="min-w-0 py-2">
      <img src="/images/platform-dashboard.webp" srcSet="/images/platform-dashboard-small.webp 800w, /images/platform-dashboard.webp 1440w" sizes="(min-width: 1024px) 55vw, 95vw" width={1440} fetchPriority="high" alt="Sample ArkiLaunch dashboard showing invoicing, fleet utilization, weather advisories and field logs for review." className="block h-auto w-full rounded-md shadow-md" />
      <figcaption className="pt-3 text-right text-xs text-text-muted">ArkiLaunch dashboard · illustrative sample data</figcaption>
    </figure>
  );
}

function PlatformLanding() {
  return (
    <PlatformChrome>
      <main id="main" className="mx-auto flex w-full max-w-shell flex-1 flex-col gap-16 px-4 pb-16 pt-12 sm:px-8 lg:gap-24 lg:pb-24 lg:pt-20">
        <section className="grid items-center gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="flex min-w-0 flex-col gap-6">
            <p className="text-sm font-medium text-accent">Built for equipment rental businesses</p>
            <h1 className="max-w-lg text-display-lg text-text lg:text-display-xl">Run your equipment rental business in one place.</h1>
            <p className="max-w-lg text-body-lg text-text-muted">Manage your fleet, quotations, dispatch, field timesheets and billing. Give your team one workspace and your customers a storefront with your name on it.</p>
            <div className="flex flex-wrap gap-3"><Link to="/register" className={registerLink}>Register your company <ArrowRight aria-hidden className="size-4" /></Link><a href="#partners" className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-border-strong px-5 text-sm font-medium text-text hover:bg-surface-sunk">Explore rental partners</a></div>
            <p className="text-sm text-text-muted">Your fleet. Your rates. Your company’s identity.</p>
          </div>
          <ProductPreview />
        </section>
        <Features />
        <Partners />
        <GettingStarted />
        <ClosingCta />
      </main>
    </PlatformChrome>
  );
}

export { PlatformLanding };
