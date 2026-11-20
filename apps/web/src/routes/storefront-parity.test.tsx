import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { CatalogEquipment, CatalogTenant } from '@arkilaunch/shared';
import { renderRoute } from '../test/render-route.js';
import { snapshotHtml, type SnapshotPage } from '../lib/snapshot.js';

// Anti-cloaking guard: every text the edge snapshot serves crawlers must also be on the page React renders.

const tenant: CatalogTenant = {
  name: 'Almara Construction',
  logoUrl: null,
  heroUrl: null,
  iconUrl: null,
  loginUrl: null,
  primaryColor: null,
  headerColor: null,
  font: null,
  facebookUrl: 'https://www.facebook.com/almara',
  messengerUrl: null,
  tagline: 'Precision equipment for every project.',
  about: 'We rent excavators across Metro Manila. Operators available.',
  phone: '0917 000 0000',
  contactEmail: 'rent@almara.test',
  address: '12 Mindanao Ave',
  city: 'Quezon City',
  province: 'Metro Manila',
  serviceAreas: ['Quezon City', 'Bulacan'],
  hours: { openTime: '07:00', closeTime: '17:00', openDays: [1, 2, 3, 4, 5, 6] },
  sameAs: ['https://www.linkedin.com/company/almara'],
};
const unit: CatalogEquipment = {
  id: '22222222-2222-4222-8222-222222222222',
  equipmentTypeName: 'Excavator',
  model: 'Komatsu PC200-8',
  availabilityStatus: 'available',
  photoUri: null,
  rateValue: 2500,
  optionGroups: [{ name: 'Bucket', values: ['0.8 m³'] }],
};

afterEach(() => vi.unstubAllGlobals());

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const href = String(url);
      const body = href.includes('/catalog/tenant')
        ? tenant
        : href.includes('/catalog/testimonials')
          ? { items: [] }
          : /\/catalog\/equipment\/[^?]+/.test(href)
            ? unit
            : { items: [unit] };
      return Promise.resolve(new Response(JSON.stringify(body)));
    }),
  );
}

function snapshotTexts(page: SnapshotPage): string[] {
  const doc = new DOMParser().parseFromString(snapshotHtml(page), 'text/html');
  return [...doc.querySelectorAll('h1, h2, h3, a, dt, dd, main p')].map((el) => el.textContent!.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const norm = (s: string) => s.replace(/\s+/g, ' ');

const cases: [string, SnapshotPage][] = [
  ['/', { kind: 'home', tenant, equipment: [unit] }],
  ['/equipment', { kind: 'equipment', tenant, equipment: [unit] }],
  [`/equipment/${unit.id}`, { kind: 'detail', tenant, eq: unit }],
  ['/contact', { kind: 'contact', tenant }],
];

describe('edge snapshot parity', () => {
  it.each(cases)('%s shows everything its snapshot serves', async (path, page) => {
    stub();
    const view = await renderRoute(path);
    await screen.findAllByText(page.kind === 'detail' ? unit.model : page.kind === 'contact' ? 'Contact' : /Komatsu PC200-8|Browse equipment/);
    const texts = snapshotTexts(page);
    expect(texts.length).toBeGreaterThan(3);
    await waitFor(() => {
      const rendered = norm(document.body.textContent ?? '');
      const missing = texts.filter((t) => !rendered.includes(t));
      expect(missing).toEqual([]);
    });
    view.unmount();
  });
});
