import { describe, expect, it, beforeAll } from 'vitest';
import postgres from 'postgres';
import type { RequestContext } from '@arkilaunch/shared';
import { CatalogService } from '../src/catalog/catalog.service.js';
import { CatalogRatesController } from '../src/catalog/catalog-rates.controller.js';
import type { CtxRequest } from '../src/common/request.js';

// Prices are for signed-in, KYC-verified customers only; the public catalog never carries one.
describe('Catalog price gate', () => {
  const catalog = new CatalogService();
  const rates = new CatalogRatesController();
  let customerCtx: RequestContext;
  let adminCtx: RequestContext;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_DIRECT;
    if (!url) throw new Error('DATABASE_URL_DIRECT is required');
    const sql = postgres(url, { max: 1 });
    const [tenant] = await sql`select id from tenants where slug = 'test-tenant-a'`;
    const tenantId = (tenant as { id: string }).id;
    const [customer] = await sql`select id from users where tenant_id = ${tenantId} and email = 'customer@test-tenant-a.test'`;
    const [admin] = await sql`select id from users where tenant_id = ${tenantId} and email <> 'customer@test-tenant-a.test' limit 1`;
    customerCtx = { tenantId, userId: (customer as { id: string }).id, role: 'customer' };
    adminCtx = { tenantId, userId: (admin as { id: string }).id, role: 'admin' };
    await sql.end();
  });

  it('never returns a price from the public catalog', async () => {
    const { items } = await catalog.listEquipment('test-tenant-a', { limit: 100, offset: 0 });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((eq) => eq.rateValue === null)).toBe(true);
    expect((await catalog.getEquipment('test-tenant-a', items[0]!.id)).rateValue).toBeNull();
  });

  it('returns rates to a verified customer only', async () => {
    const { items } = await rates.rates({ ctx: customerCtx } as CtxRequest);
    expect(items.some((r) => r.rateValue !== null)).toBe(true);
    // No company of their own, so not verified.
    await expect(rates.rates({ ctx: adminCtx } as CtxRequest)).rejects.toMatchObject({ response: { error: 'kyc_required' } });
  });
});
