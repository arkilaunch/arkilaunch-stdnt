import type { QueryClient } from '@tanstack/react-query';
import { CatalogEquipmentListResponseSchema, CatalogEquipmentSchema, CatalogTenantSchema } from '@arkilaunch/shared';
import { SEED_ID } from './snapshot.js';

// The edge Worker ships the catalog data it rendered the snapshot from; putting it in the query cache lets React's
// first paint show the same content instead of a skeleton. Anything malformed is ignored and the queries fetch as usual.
export function applyCatalogSeed(client: QueryClient, doc: Document = document): void {
  const el = doc.getElementById(SEED_ID);
  if (!el?.textContent) return;
  let raw: { tenant?: unknown; equipment?: unknown; detail?: unknown };
  try {
    raw = JSON.parse(el.textContent) as typeof raw;
  } catch {
    return;
  } finally {
    el.remove();
  }
  const tenant = CatalogTenantSchema.safeParse(raw.tenant);
  if (!tenant.success) return;
  client.setQueryData(['catalog', 'tenant'], tenant.data);
  const equipment = CatalogEquipmentListResponseSchema.safeParse(raw.equipment);
  if (equipment.success) client.setQueryData(['catalog', 'equipment'], equipment.data);
  const detail = CatalogEquipmentSchema.safeParse(raw.detail);
  if (detail.success) client.setQueryData(['catalog', 'equipment', detail.data.id], detail.data);
}
