import { describe, expect, it } from 'vitest';
import type { CatalogEquipment, CatalogTenant } from '@arkilaunch/shared';
import {
  brandVars,
  equipmentPage,
  headTags,
  isIndexable,
  isKnownPath,
  onPrimaryFor,
  pageTitle,
  sitemapXml,
  tenantRobotsTxt,
  tenantSitemapEntries,
  webManifest,
} from './brand.js';

const ldBlocks = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);

describe('onPrimaryFor', () => {
  it('picks the higher-contrast text color', () => {
    expect(onPrimaryFor('#f2a100')).toBe('#000000'); // amber: dark text (DSD §2.1)
    expect(onPrimaryFor('#1e5f8c')).toBe('#ffffff'); // dispatch blue: white text
    expect(onPrimaryFor('#5ec2c2')).toBe('#000000'); // Almara teal: white would be 2.1:1
    expect(onPrimaryFor('#a23e01')).toBe('#ffffff'); // Almara rust bar
    expect(onPrimaryFor('#ffffff')).toBe('#000000');
    expect(onPrimaryFor('#000000')).toBe('#ffffff');
  });
});

describe('brandVars', () => {
  it('sets nothing for the ArkiLaunch defaults', () => {
    expect(brandVars({ primaryColor: null, font: null })).toEqual({});
    expect(brandVars(undefined)).toEqual({});
  });

  it('paints the primary with its hover and text color', () => {
    expect(brandVars({ primaryColor: '#5ec2c2', font: null })).toEqual({
      '--yb-color-primary': '#5ec2c2',
      '--yb-color-primary-hover': 'color-mix(in srgb, #5ec2c2 85%, black)',
      '--yb-color-on-primary': '#000000',
    });
  });

  it('swaps prose to IBM Plex for a Plex tenant, never mono; Inter is the default', () => {
    const vars = brandVars({ primaryColor: null, font: 'plex' });
    expect(vars['--font-sans']).toMatch(/^'IBM Plex Sans'/);
    expect(Object.keys(vars)).not.toContain('--font-mono');
    expect(brandVars({ primaryColor: null, font: 'inter' })).toEqual({});
  });
});

describe('pageTitle', () => {
  const qc = { name: 'Almara Construction', city: 'Quezon City' };

  it('titles storefront pages after their heading, with the city for local search', () => {
    expect(pageTitle('/', qc)).toBe('Almara Construction | Equipment rental in Quezon City');
    expect(pageTitle('/equipment', qc)).toBe('Equipment for rent in Quezon City | Almara Construction');
    expect(pageTitle('/contact/', qc)).toBe('Contact | Almara Construction');
    expect(pageTitle('/app/branding', qc)).toBe('Almara Construction');
  });

  it('drops the city when the tenant has none', () => {
    expect(pageTitle('/', { name: 'Almara Construction', city: null })).toBe('Almara Construction');
    expect(pageTitle('/equipment', { name: 'Almara Construction', city: null })).toBe('Equipment for rent | Almara Construction');
  });

  it('leaves an equipment page to title itself with its model', () => {
    expect(pageTitle('/equipment/abc', qc)).toBeNull();
    expect(pageTitle('/equipment/abc', qc, 'CAT D6R')).toBe('CAT D6R | Almara Construction');
  });
});

const almara: CatalogTenant = {
  name: 'Almara Construction',
  logoUrl: 'https://cdn.test/logo.png',
  heroUrl: null,
  iconUrl: 'https://cdn.test/icon.png',
  loginUrl: null,
  primaryColor: '#5ec2c2',
  headerColor: '#a23e01',
  font: 'inter',
  facebookUrl: 'https://www.facebook.com/almara',
  messengerUrl: null,
  tagline: 'Precision industrial equipment for every project.',
  about: null,
  phone: '0917 000 0000',
  contactEmail: null,
  address: null,
  city: 'Pasig',
  province: 'Metro Manila',
};

describe('headTags', () => {
  it('writes the tenant head for its home page', () => {
    const html = headTags(almara, new URL('https://almara.arkilaunch.app/'));
    expect(html).toContain('<meta name="description" content="Precision industrial equipment for every project." />');
    expect(html).toContain('<link rel="canonical" href="https://almara.arkilaunch.app/" />');
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/icon.png" />');
    expect(html).toContain('<link rel="icon" href="https://cdn.test/icon.png" />');
    expect(html).toContain('<meta name="theme-color" content="#a23e01" />');
    expect(html).toContain('<meta property="og:locale" content="en_PH" />');
    expect(html).toContain('<meta name="twitter:title" content="Almara Construction | Equipment rental in Pasig" />');
    expect(html).toContain('<meta name="twitter:image" content="https://cdn.test/icon.png" />');
    const [ld] = ldBlocks(html);
    const [business, website] = ld!['@graph'] as Record<string, unknown>[];
    expect(business).toMatchObject({
      '@type': 'LocalBusiness',
      '@id': 'https://almara.arkilaunch.app/#business',
      name: 'Almara Construction',
      telephone: '0917 000 0000',
      sameAs: ['https://www.facebook.com/almara'],
    });
    expect(business!.address).toMatchObject({ addressLocality: 'Pasig', addressRegion: 'Metro Manila', addressCountry: 'PH' });
    expect(website).toMatchObject({ '@type': 'WebSite', publisher: { '@id': 'https://almara.arkilaunch.app/#business' } });
  });

  it('keeps the business graph to the home page and uses the detail on an equipment page', () => {
    const html = headTags(almara, new URL('https://almara.arkilaunch.app/equipment/x/'), {
      title: 'CAT D6R',
      description: 'CAT D6R (Bulldozer) for rent from Almara Construction.',
      imageUrl: 'https://cdn.test/d6r.jpg',
    });
    expect(html).not.toContain('ld+json');
    expect(html).toContain('content="CAT D6R | Almara Construction"');
    expect(html).toContain('<link rel="canonical" href="https://almara.arkilaunch.app/equipment/x" />');
    expect(html).toContain('content="https://cdn.test/d6r.jpg"');
  });

  it('cannot be broken out of by a hostile tenant string', () => {
    const evil = { ...almara, name: '"><script>alert(1)</script>', tagline: '</script><img src=x onerror=alert(1)>' };
    const html = headTags(evil, new URL('https://evil.arkilaunch.app/'));
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
    // One real script element only, and its body can't close it.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});

const d6r: CatalogEquipment = {
  id: '11111111-1111-4111-8111-111111111111',
  equipmentTypeName: 'Bulldozer',
  model: 'CAT D6R',
  availabilityStatus: 'available',
  photoUri: 'https://cdn.test/d6r.jpg',
  rateType: 'hourly',
  rateValue: 2500,
};

describe('equipmentPage', () => {
  const origin = 'https://almara.arkilaunch.app';

  it('describes the unit locally, with its hourly rate', () => {
    const page = equipmentPage(d6r, almara, origin);
    expect(page.title).toBe('CAT D6R');
    expect(page.description).toMatch(/^CAT D6R bulldozer for rent in Pasig from Almara Construction \(₱2,500\.00\/hour\)\.$/);
    expect(page.description.length).toBeLessThanOrEqual(160);
  });

  it('marks up the breadcrumb and a lease offer seller-linked to the business', () => {
    const [crumbs, product] = equipmentPage(d6r, almara, origin).jsonLd!;
    expect(crumbs).toMatchObject({ '@type': 'BreadcrumbList' });
    expect((crumbs!.itemListElement as unknown[]).length).toBe(3);
    expect(product).toMatchObject({
      '@type': 'Product',
      name: 'CAT D6R',
      category: 'Bulldozer',
      offers: {
        price: 2500,
        priceCurrency: 'PHP',
        priceSpecification: { unitCode: 'HUR' },
        businessFunction: 'http://purl.org/goodrelations/v1#LeaseOut',
        seller: { '@id': `${origin}/#business` },
      },
    });
  });

  it('claims no offer when the page shows "Price on request"', () => {
    const page = equipmentPage({ ...d6r, rateValue: null }, { ...almara, city: null }, origin);
    expect(page.jsonLd!.map((ld) => ld['@type'])).toEqual(['BreadcrumbList']);
    expect(page.description).toBe('CAT D6R bulldozer for rent from Almara Construction.');
  });

  it('writes one escaped script per block into the head', () => {
    const evil = { ...d6r, model: '</script><script>alert(1)</script>' };
    const html = headTags(almara, new URL(`${origin}/equipment/${d6r.id}`), equipmentPage(evil, almara, origin));
    expect(html).not.toContain('<script>alert');
    expect(ldBlocks(html)).toHaveLength(2);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });
});

describe('isIndexable', () => {
  it('opens the public storefront pages only', () => {
    for (const p of ['/', '/equipment', '/equipment/abc', '/contact/', '/help', '/terms', '/privacy']) expect(isIndexable(p), p).toBe(true);
    for (const p of ['/login', '/signup', '/app', '/app/branding', '/account/cart', '/field', '/equipment/a/b']) expect(isIndexable(p), p).toBe(false);
  });
});

describe('isKnownPath', () => {
  it('knows the router paths and nothing else', () => {
    for (const p of ['/', '/equipment/', '/login', '/register/company', '/app', '/app/inventory', '/account/cart', '/field/scan', '/admin/companies'])
      expect(isKnownPath(p), p).toBe(true);
    for (const p of ['/nope', '/equipment/a/b', '/application', '/fieldwork', '/wp-login.php', '/contact/us']) expect(isKnownPath(p), p).toBe(false);
  });
});

describe('robots and sitemap', () => {
  it('opens public pages to search, answer and training crawlers, never the signed-in areas', () => {
    const robots = tenantRobotsTxt('https://almara.arkilaunch.app');
    for (const bot of ['Googlebot', 'GPTBot', 'ClaudeBot', 'Google-Extended', 'OAI-SearchBot', 'PerplexityBot', '*'])
      expect(robots).toContain(`User-agent: ${bot}\n`);
    expect(robots).toContain('Allow: /\n');
    for (const p of ['/app/', '/account/', '/field/', '/admin/', '/activate', '/reset-password']) expect(robots).toContain(`Disallow: ${p}\n`);
    // Sign-in pages stay crawlable so crawlers see their noindex.
    expect(robots).not.toMatch(/Disallow: \/(login|signup|register)/);
    expect(robots).toContain('Sitemap: https://almara.arkilaunch.app/sitemap.xml');
    expect(robots).not.toMatch(/Disallow: \/\n/);
  });

  it('lists the public pages and equipment, with lastmod when known', () => {
    const xml = sitemapXml('https://almara.arkilaunch.app', tenantSitemapEntries(null, [{ id: 'e1' }]));
    expect(xml).toContain('<url><loc>https://almara.arkilaunch.app/</loc></url>');
    expect(xml).toContain('<loc>https://almara.arkilaunch.app/equipment/e1</loc>');
    expect(xml).not.toContain('/app');
    expect(sitemapXml('https://a.test', [{ path: '/', lastmod: '2026-11-20' }])).toContain('<loc>https://a.test/</loc><lastmod>2026-11-20</lastmod>');
  });
});
describe('webManifest', () => {
  it('is the ArkiLaunch app on the platform host', () => {
    const m = webManifest(null);
    expect(m).toMatchObject({ name: 'ArkiLaunch', display: 'standalone', start_url: '/', theme_color: '#10151B' });
    expect(m.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
  });

  it("installs as the tenant's app: its name, header color and square icon first", () => {
    const m = webManifest({ name: 'Almara Equipment Rentals', iconUrl: 'https://cdn/almara-icon.png', headerColor: '#123456', primaryColor: '#F2A100' });
    expect(m).toMatchObject({ name: 'Almara Equipment Rentals', short_name: 'Almara', theme_color: '#123456' });
    expect(m.icons[0]).toEqual({ src: 'https://cdn/almara-icon.png', sizes: 'any', purpose: 'any' });
    expect(m.icons).toHaveLength(4); // the platform PNGs stay so the browser can always install
  });
});

describe('tenant SEO fields (CR tenant-seo-geo P3)', () => {
  const tuned: CatalogTenant = {
    ...almara,
    seoTitle: 'Almara Construction | Heavy Equipment Rental in Quezon City',
    seoDescription: 'Excavators and dump trucks for rent across Metro Manila.',
    businessType: 'HomeAndConstructionBusiness',
    serviceAreas: ['Quezon City', 'Bulacan'],
    location: { lat: 14.676, lng: 121.0437 },
    sameAs: ['https://www.linkedin.com/company/almara', 'https://www.facebook.com/almara'],
    hours: { openTime: '07:00', closeTime: '17:00', openDays: [6, 1, 2, 3, 4, 5] },
  };

  it('uses the owner-written title and description on the home page only', () => {
    const home = headTags(tuned, new URL('https://almara.arkilaunch.app/'));
    expect(pageTitle('/', tuned)).toBe('Almara Construction | Heavy Equipment Rental in Quezon City');
    expect(home).toContain('<meta name="description" content="Excavators and dump trucks for rent across Metro Manila." />');
    const contact = headTags(tuned, new URL('https://almara.arkilaunch.app/contact'));
    expect(contact).toContain('content="Precision industrial equipment for every project."');
  });

  it('enriches the business node: type, areas, geo, hours and deduped profile links', () => {
    const [ld] = ldBlocks(headTags(tuned, new URL('https://almara.arkilaunch.app/')));
    const [business] = ld!['@graph'] as Record<string, unknown>[];
    expect(business).toMatchObject({
      '@type': 'HomeAndConstructionBusiness',
      areaServed: ['Quezon City', 'Bulacan'],
      geo: { '@type': 'GeoCoordinates', latitude: 14.676, longitude: 121.0437 },
      openingHoursSpecification: {
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        opens: '07:00',
        closes: '17:00',
      },
    });
    expect(business!.sameAs).toEqual(['https://www.facebook.com/almara', 'https://www.linkedin.com/company/almara']);
  });

  it('dates sitemap entries from tenant and listing changes', () => {
    const entries = tenantSitemapEntries({ contentUpdatedAt: '2026-11-01T03:00:00.000Z' }, [
      { id: 'e1', updatedAt: '2026-11-15T03:00:00.000Z' },
      { id: 'e2', updatedAt: null },
    ]);
    const at = (p: string) => entries.find((e) => e.path === p)?.lastmod;
    expect(at('/')).toBe('2026-11-01');
    expect(at('/equipment')).toBe('2026-11-15');
    expect(at('/equipment/e1')).toBe('2026-11-15');
    expect(at('/equipment/e2')).toBeNull();
    expect(at('/terms')).toBeNull();
  });
});
