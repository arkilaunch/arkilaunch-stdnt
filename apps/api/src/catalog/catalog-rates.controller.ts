import { Controller, ForbiddenException, Get, NotFoundException, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { listCatalogRatesForSlug, tenants, withTenantTx } from '@arkilaunch/db';
import type { CatalogRateListResponse } from '@arkilaunch/shared';
import { ownCustomers } from '../common/customer-scope.js';
import type { CtxRequest } from '../common/request.js';

// Deliberately not @RequirePermission: any signed-in caller may ask, but only one with a KYC-approved
// company of their own gets prices. The tenant comes from the JWT, never the storefront slug.
@Controller('catalog/rates')
export class CatalogRatesController {
  @Get()
  async rates(@Req() req: CtxRequest): Promise<CatalogRateListResponse> {
    const slug = await withTenantTx(req.ctx, async (tx) => {
      const own = await ownCustomers(tx, req.ctx);
      if (!own.some((company) => company.kycStatus === 'approved')) throw new ForbiddenException({ error: 'kyc_required' });
      const [tenant] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, req.ctx.tenantId)).limit(1);
      return tenant?.slug;
    });
    if (!slug) throw new NotFoundException({ error: 'tenant_not_found' });
    return { items: await listCatalogRatesForSlug(slug) };
  }
}
