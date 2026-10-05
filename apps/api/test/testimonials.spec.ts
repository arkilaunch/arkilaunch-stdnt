import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import postgres from 'postgres';
import { TestimonialWriteSchema, type RequestContext } from '@arkilaunch/shared';
import { TenantsService } from '../src/tenants/tenants.service.js';
import { TenantsController } from '../src/tenants/tenants.controller.js';
import { CatalogService } from '../src/catalog/catalog.service.js';
import { PermissionsGuard } from '../src/common/guards/permissions.guard.js';

describe('tenant-managed testimonials', () => {
  const service = new TenantsService(null as never, null as never);
  it('CRUD stays tenant-scoped and public reads return headline', async () => {
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    const ids = [randomUUID(), randomUUID()];
    const slugs = ids.map((id) => `testimonial-${id}`);
    const ctx = ids.map(
      (tenantId) => ({ tenantId, userId: randomUUID(), role: 'admin' }) as RequestContext,
    );
    try {
      for (let i = 0; i < 2; i++)
        await sql`insert into tenants (id, legal_name, slug, status) values (${ids[i]!}, 'QA fixture', ${slugs[i]!}, 'active')`;
      const input = TestimonialWriteSchema.parse({
        headline: 'QA headline',
        quote: 'QA fixture text',
        authorName: 'QA fixture author',
        authorTitle: '',
      });
      const row = (await service.createTestimonial(ctx[0]!, input))!;
      expect((await service.listTestimonials(ctx[0]!)).items.map((t) => t.id)).toContain(row.id);
      expect((await service.listTestimonials(ctx[1]!)).items).toEqual([]);
      await expect(service.updateTestimonial(ctx[1]!, row.id, input)).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.deleteTestimonial(ctx[1]!, row.id)).rejects.toMatchObject({
        status: 404,
      });
      const catalog = new CatalogService();
      expect((await catalog.listTestimonials(slugs[0]!)).items).toContainEqual(
        expect.objectContaining({ id: row.id, headline: 'QA headline' }),
      );
      expect((await catalog.listTestimonials(slugs[1]!)).items).toEqual([]);
      await service.updateTestimonial(ctx[0]!, row.id, {
        ...input,
        headline: null,
        quote: 'Updated QA text',
      });
      expect((await catalog.listTestimonials(slugs[0]!)).items[0]).toMatchObject({
        headline: null,
        quote: 'Updated QA text',
      });
      await service.deleteTestimonial(ctx[0]!, row.id);
      expect((await service.listTestimonials(ctx[0]!)).items).toEqual([]);
    } finally {
      await sql`delete from testimonials where tenant_id in ${sql(ids)}`;
      await sql`delete from truck_ban_rules where tenant_id in ${sql(ids)}`;
      await sql`delete from tenants where id in ${sql(ids)}`;
      await sql.end();
    }
  });
  it('denies customer permission on every staff testimonial endpoint', async () => {
    const guard = new PermissionsGuard(new Reflector());
    for (const method of [
      'listTestimonials',
      'createTestimonial',
      'updateTestimonial',
      'deleteTestimonial',
    ] as const) {
      const context = {
        getHandler: () => TenantsController.prototype[method],
        getClass: () => TenantsController,
        switchToHttp: () => ({
          getRequest: () => ({
            ctx: { tenantId: randomUUID(), userId: randomUUID(), role: 'customer' },
          }),
        }),
      } as unknown as ExecutionContext;
      expect(await guard.canActivate(context)).toBe(false);
    }
  });
  it('rejects oversized fields and supplied tenant IDs', () => {
    const input = { headline: null, quote: 'Quote', authorName: 'Author', authorTitle: '' };
    for (const [field, length] of [
      ['headline', 61],
      ['quote', 281],
      ['authorName', 81],
      ['authorTitle', 81],
    ] as const) {
      expect(
        TestimonialWriteSchema.safeParse({ ...input, [field]: 'x'.repeat(length) }).success,
      ).toBe(false);
    }
    expect(TestimonialWriteSchema.safeParse({ ...input, tenantId: randomUUID() }).success).toBe(
      false,
    );
  });
});
