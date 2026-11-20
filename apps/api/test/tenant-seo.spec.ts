import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { registerTenant } from '@arkilaunch/db';
import { TenantSeoUpdateRequestSchema } from '@arkilaunch/shared';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { CatalogService } from '../src/catalog/catalog.service.js';
import { TenantsService } from '../src/tenants/tenants.service.js';

// CR: tenant-seo-geo P3 (migration 0097).

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

const branding = {
  primaryColor: null,
  headerColor: null,
  font: null,
  facebookUrl: null,
  messengerUrl: null,
  tagline: 'Excavators on time',
  about: null,
  phone: null,
  contactEmail: null,
  address: null,
  city: 'Quezon City',
  province: 'Metro Manila',
};

const seo = TenantSeoUpdateRequestSchema.parse({
  seoTitle: 'SEO Rentals | Heavy Equipment Rental in Quezon City',
  seoDescription: 'Excavators and dump trucks for rent across Metro Manila.',
  businessType: 'HomeAndConstructionBusiness',
  serviceAreas: ['Quezon City', 'Bulacan', 'quezon city'],
  location: { lat: 14.676, lng: 121.0437 },
  sameAs: ['https://www.linkedin.com/company/seo-rentals'],
  publishHours: false,
});

async function liveTenant(auth: AuthService) {
  const slug = `seo-${randomUUID().slice(0, 8)}`;
  const reg = await registerTenant({
    legalName: 'SEO Rentals',
    slug,
    ownerEmail: `${slug}@seo.test`,
    placeholderPasswordHash: 'placeholder',
    companyName: 'SEO Rentals',
    businessAddress: 'Quezon City',
    secNumber: 'CS201912345',
    tin: '123-456-789-000',
    contactFirstName: 'Sam',
    contactLastName: 'Search',
    contactMobile: '09170000000',
    contactJobTitle: 'Owner',
  });
  const token = auth.signActivationToken(reg.tenantId, reg.ownerUserId, 'placeholder');
  await auth.activate({ activationToken: token, password: 'a long enough password' });
  return { slug, reg, ctx: { tenantId: reg.tenantId, userId: reg.ownerUserId, role: 'owner' } as never };
}

describe('tenant search settings', () => {
  const auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());
  const tenants = new TenantsService(auth, null as never);
  const catalog = new CatalogService();

  it('round-trips to the storefront and survives a branding save', async () => {
    const { slug, reg, ctx } = await liveTenant(auth);
    expect(await tenants.getSeo(reg.tenantId)).toMatchObject({ seoTitle: null, serviceAreas: [], sameAs: [], publishHours: false });

    const saved = await tenants.updateSeo(ctx, reg.tenantId, seo);
    expect(saved).toMatchObject({
      seoTitle: 'SEO Rentals | Heavy Equipment Rental in Quezon City',
      businessType: 'HomeAndConstructionBusiness',
      location: { lat: 14.676, lng: 121.0437 },
      sameAs: ['https://www.linkedin.com/company/seo-rentals'],
    });
    expect(saved.serviceAreas).toHaveLength(2);

    // No-wipe: the branding write is a different function and never touches these columns.
    await tenants.updateBranding(ctx, reg.tenantId, branding);
    const shop = await catalog.getTenant(slug);
    expect(shop).toMatchObject({
      seoTitle: 'SEO Rentals | Heavy Equipment Rental in Quezon City',
      seoDescription: 'Excavators and dump trucks for rent across Metro Manila.',
      businessType: 'HomeAndConstructionBusiness',
      location: { lat: 14.676, lng: 121.0437 },
      city: 'Quezon City',
      hours: null, // not published
    });
    expect(shop.contentUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('publishes hours only when the tenant opts in', async () => {
    const { slug, reg, ctx } = await liveTenant(auth);
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    await sql`insert into tenant_calendar (tenant_id, open_time, close_time, open_days)
      values (${reg.tenantId}, '07:00', '17:00', '{1,2,3,4,5,6}') on conflict (tenant_id) do nothing`;
    await sql.end();
    expect((await catalog.getTenant(slug)).hours).toBeNull();
    const hours = { openTime: '07:00', closeTime: '17:00', openDays: [1, 2, 3, 4, 5, 6] };
    expect((await tenants.updateSeo(ctx, reg.tenantId, { ...seo, publishHours: true })).hours).toEqual(hours);
    expect((await catalog.getTenant(slug)).hours).toEqual(hours);
  });

  it('refuses an unknown company, and the database refuses what the schema would', async () => {
    await expect(tenants.updateSeo({ userId: randomUUID() } as never, randomUUID(), seo)).rejects.toThrow(NotFoundException);
    await expect(tenants.getSeo(randomUUID())).rejects.toThrow(NotFoundException);

    const { reg } = await liveTenant(auth);
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    try {
      const attempts = [
        () => sql`update tenants set same_as = '{http://insecure.test}' where id = ${reg.tenantId}`,
        () => sql`update tenants set latitude = 121, longitude = 14 where id = ${reg.tenantId}`,
        () => sql`update tenants set latitude = 14.6 where id = ${reg.tenantId}`,
        () => sql`update tenants set business_type = 'Casino' where id = ${reg.tenantId}`,
        () => sql`update tenants set seo_title = '' where id = ${reg.tenantId}`,
      ];
      for (const attempt of attempts) await expect(attempt()).rejects.toThrow(/check constraint/);
    } finally {
      await sql.end();
    }
  });

  it('moves lastmod on listing content, not on runtime hours', async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    try {
      const [eq] = await sql<{ id: string; content_updated_at: Date }[]>`
        update equipment set content_updated_at = now() - interval '1 day'
        where id = (select id from equipment order by id limit 1) returning id, content_updated_at`;
      if (!eq) return; // no fleet seeded in this database
      const [afterHours] = await sql<{ content_updated_at: Date }[]>`
        update equipment set runtime_hours = runtime_hours + 1 where id = ${eq.id} returning content_updated_at`;
      expect(afterHours!.content_updated_at.getTime()).toBe(eq.content_updated_at.getTime());
      const [afterCredit] = await sql<{ content_updated_at: Date }[]>`
        update equipment set photo_credit = coalesce(photo_credit, '') || '.' where id = ${eq.id} returning content_updated_at`;
      expect(afterCredit!.content_updated_at.getTime()).toBeGreaterThan(eq.content_updated_at.getTime());
    } finally {
      await sql.end();
    }
  });
});
