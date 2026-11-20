import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { CatalogEquipment, CatalogTenant } from '@arkilaunch/shared';
import { escapeText, llmsTxt, seedScript, snapshotHtml } from './snapshot.js';
import { applyCatalogSeed } from './catalog-seed.js';

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
};

const unit = (n: number, over: Partial<CatalogEquipment> = {}): CatalogEquipment => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  equipmentTypeName: 'Excavator',
  model: `PC200 #${n}`,
  availabilityStatus: 'available',
  photoUri: null,
  rateValue: 2500,
  ...over,
});

describe('snapshotHtml', () => {
  it('home: tagline h1, preview links, no prices, no maintenance units', () => {
    const items = [unit(1), unit(2, { availabilityStatus: 'maintenance', model: 'In the shop' })];
    const html = snapshotHtml({ kind: 'home', tenant, equipment: items });
    expect(html).toContain('<h1>Precision equipment for every project.</h1>');
    expect(html).toContain('<p>We rent excavators across Metro Manila.</p>');
    expect(html).toContain(`<a href="/equipment/${unit(1).id}">PC200 #1</a>`);
    expect(html).not.toContain('In the shop');
    expect(html).not.toContain('₱');
    expect(html).toContain('How renting works');
  });

  it('home: links "See all" only past the preview size', () => {
    const many = Array.from({ length: 7 }, (_, i) => unit(i));
    expect(snapshotHtml({ kind: 'home', tenant, equipment: many })).toContain('See all 7 machines');
    expect(snapshotHtml({ kind: 'home', tenant, equipment: many.slice(0, 6) })).not.toContain('See all');
  });

  it('catalog and detail show the hourly rate or "Price on request"', () => {
    const list = snapshotHtml({ kind: 'equipment', tenant, equipment: [unit(1), unit(2, { rateValue: null })] });
    expect(list).toContain('₱2,500.00 / hour');
    expect(list).toContain('Price on request');
    const page = snapshotHtml({ kind: 'detail', tenant, eq: unit(1, { optionGroups: [{ name: 'Bucket', values: ['0.8 m³'] }] }) });
    expect(page).toContain('<nav aria-label="Breadcrumb">');
    expect(page).toContain('<h1>PC200 #1</h1>');
    expect(page).toContain('<dt>Bucket:</dt>');
  });

  it('contact lists the business details', () => {
    const html = snapshotHtml({ kind: 'contact', tenant });
    expect(html).toContain('<dd>12 Mindanao Ave, Quezon City, Metro Manila</dd>');
    expect(html).toContain('href="mailto:rent@almara.test"');
  });

  it('cannot be broken out of by tenant text, and drops non-https links', () => {
    const evil = { ...tenant, tagline: '<script>alert(1)</script>', name: '"><img src=x>', facebookUrl: 'javascript:alert(1)' };
    const html = snapshotHtml({ kind: 'home', tenant: evil, equipment: [unit(1, { model: '</a><script>x</script>' })] });
    expect(html).not.toMatch(/<script|<img/);
    expect(html).not.toContain('javascript:');
    expect(escapeText('a&b<"')).toBe('a&amp;b&lt;&quot;');
  });
});

describe('seed', () => {
  const docWith = (html: string) => {
    const doc = document.implementation.createHTMLDocument('');
    doc.head.innerHTML = html;
    return doc;
  };

  it('fills the catalog queries the snapshot was built from, then removes itself', () => {
    const client = new QueryClient();
    const doc = docWith(seedScript({ tenant, equipment: { items: [unit(1)] }, detail: unit(1) }));
    applyCatalogSeed(client, doc);
    expect(client.getQueryData(['catalog', 'tenant'])).toMatchObject({ name: 'Almara Construction' });
    expect(client.getQueryData(['catalog', 'equipment'])).toMatchObject({ items: [{ model: 'PC200 #1' }] });
    expect(client.getQueryData(['catalog', 'equipment', unit(1).id])).toMatchObject({ model: 'PC200 #1' });
    expect(doc.getElementById('catalog-seed')).toBeNull();
  });

  it('ignores a malformed or invalid seed', () => {
    for (const body of ['{not json', JSON.stringify({ tenant: { name: 1 } })]) {
      const client = new QueryClient();
      applyCatalogSeed(client, docWith(`<script type="application/json" id="catalog-seed">${body}</script>`));
      expect(client.getQueryData(['catalog', 'tenant'])).toBeUndefined();
    }
  });

  it('cannot close its own script element', () => {
    expect(seedScript({ tenant: { ...tenant, tagline: '</script><script>x' } }).match(/<\/script>/g)).toHaveLength(1);
  });
});

describe('llmsTxt', () => {
  it('summarizes the yard with contact, pages and priced equipment links', () => {
    const txt = llmsTxt(tenant, 'https://almara.arkilaunch.app', [unit(1), unit(2, { availabilityStatus: 'maintenance' })]);
    expect(txt.startsWith('# Almara Construction\n\n> Precision equipment for every project.\n')).toBe(true);
    expect(txt).toContain('- Phone: 0917 000 0000');
    expect(txt).toContain(`- [PC200 #1](https://almara.arkilaunch.app/equipment/${unit(1).id}): Excavator, ₱2,500.00 / hour`);
    expect(txt).not.toContain('PC200 #2');
  });
});
