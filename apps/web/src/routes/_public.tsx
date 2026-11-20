import { createRoute, Link, Outlet, redirect, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { rootRoute } from './__root.js';
import { currentHost } from '../lib/host.js';
import { PlatformChrome } from './platform.index.js';
import { useTenant } from '../lib/tenant.js';
import { FloatingNav } from '../components/floating-nav.js';
import { SkipLink } from '../components/skip-link.js';
import { profileLinks } from '../lib/storefront-content.js';
import { FacebookIcon } from '../components/icons.js';

type FooterTo = NonNullable<LinkProps['to']>;

const FOOTER_COLUMNS: { title: string; links: { label: string; to: FooterTo }[] }[] = [
  {
    title: 'Rent',
    links: [
      { label: 'Browse equipment', to: '/equipment' },
      { label: 'My bookings', to: '/account/bookings' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { label: 'Register', to: '/signup' },
      { label: 'Sign in', to: '/login' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Contact', to: '/contact' },
      { label: 'Help center', to: '/help' },
      { label: 'Terms of service', to: '/terms' },
      { label: 'Privacy policy', to: '/privacy' },
    ],
  },
];

export function MarketingChrome({ children }: { children: ReactNode }) {
  const tenant = useTenant();
  const tenantName = tenant?.name ?? '';
  const profiles = tenant ? profileLinks(tenant) : [];
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SkipLink />
      <FloatingNav />
      <main id="main" className="mx-auto w-full max-w-shell flex-1">
        {children}
      </main>
      <footer className="bg-nav text-text-inverse">
        <div className="mx-auto flex max-w-shell flex-col gap-10 px-4 py-10 sm:flex-row sm:justify-between sm:px-8">
          <div>
            <p className="flex items-center gap-3 text-heading-md">
              {tenant?.logoUrl && <img src={tenant.logoUrl} alt="" className="h-10 w-auto max-w-[140px] rounded-xs bg-white object-contain p-1" />}
              {tenantName}
            </p>
            <p className="mt-2 text-sm text-text-inverse/70">
              {tenantName} &copy; {new Date().getFullYear()}. All rights reserved. Powered by ArkiLaunch.
            </p>
            {profiles.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium">Follow us</p>
                <ul className="mt-1 flex flex-wrap gap-x-5">
                  {profiles.map((p) => (
                    <li key={p.href}>
                      <a
                        href={p.href}
                        target="_blank"
                        rel="me noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-2 text-sm text-text-inverse/70 hover:text-text-inverse hover:underline"
                      >
                        {p.label === 'Facebook' && <FacebookIcon className="h-5 w-5" />}
                        {p.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-sm font-medium">{col.title}</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {col.links.map((link) => (
                    <li key={link.to}>
                      <Link
                        to={link.to}
                        className="text-sm text-text-inverse/70 hover:text-text-inverse hover:underline"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

function PublicLayout() {
  if (currentHost.kind === 'platform') return <PlatformChrome><main id="main" className="mx-auto w-full max-w-shell flex-1"><Outlet /></main></PlatformChrome>;
  return (
    <MarketingChrome>
      <Outlet />
    </MarketingChrome>
  );
}

export const publicLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public-layout',
  beforeLoad: ({ location }) => {
    if (currentHost.kind === 'platform' && !['/help', '/terms', '/privacy'].includes(location.pathname.replace(/\/$/, ''))) throw redirect({ to: '/' });
  },
  component: PublicLayout,
});
