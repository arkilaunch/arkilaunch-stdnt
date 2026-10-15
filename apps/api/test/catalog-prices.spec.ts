import { describe, expect, it } from 'vitest';
import { CatalogService } from '../src/catalog/catalog.service.js';

// Prices are public: KYC gates the booking request and payment, not browsing.
describe('Public catalog prices', () => {
  const catalog = new CatalogService();

  it('returns rates to an anonymous caller', async () => {
    const { items } = await catalog.listEquipment('test-tenant-a', { limit: 100, offset: 0 });
    const priced = items.find((eq) => eq.rateValue !== null);
    expect(priced).toBeDefined();
    expect((await catalog.getEquipment('test-tenant-a', priced!.id)).rateValue).toBe(priced!.rateValue);
  });

  it('never serves one tenant’s machine under another tenant’s slug', async () => {
    const { items } = await catalog.listEquipment('test-tenant-a', { limit: 100, offset: 0 });
    await expect(catalog.getEquipment('test-tenant-b', items[0]!.id)).rejects.toMatchObject({ response: { error: 'equipment_not_found' } });
  });
});
