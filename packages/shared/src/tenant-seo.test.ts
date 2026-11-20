import { describe, expect, it } from 'vitest';
import { TenantSeoUpdateRequestSchema } from './tenants.js';

const base = {
  seoTitle: null,
  seoDescription: null,
  businessType: null,
  serviceAreas: [],
  location: null,
  sameAs: [],
  publishHours: false,
};

describe('TenantSeoUpdateRequestSchema', () => {
  it('stores empty text as null and dedupes areas and links', () => {
    const out = TenantSeoUpdateRequestSchema.parse({
      ...base,
      seoTitle: '  ',
      serviceAreas: [' Quezon City ', 'quezon city', 'Bulacan'],
      sameAs: ['https://www.linkedin.com/company/a', 'https://www.linkedin.com/company/a'],
    });
    expect(out.seoTitle).toBeNull();
    expect(out.serviceAreas).toHaveLength(2);
    expect(out.sameAs).toEqual(['https://www.linkedin.com/company/a']);
  });

  it('rejects non-https links, swapped coordinates, unknown types, extra keys and long text', () => {
    for (const bad of [
      { sameAs: ['http://insecure.test'] },
      { sameAs: ['javascript:alert(1)'] },
      { sameAs: ['https://user:pw@evil.test'] },
      { location: { lat: 121.04, lng: 14.67 } },
      { businessType: 'Casino' },
      { legalName: 'Renamed' },
      { seoTitle: 'x'.repeat(71) },
      { seoDescription: 'x'.repeat(161) },
      { serviceAreas: Array.from({ length: 21 }, (_, i) => `Area ${i}`) },
      { sameAs: Array.from({ length: 9 }, (_, i) => `https://a${i}.test/`) },
    ])
      expect(TenantSeoUpdateRequestSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });
});
