import { afterEach, describe, expect, it, vi } from 'vitest';

const rows = [{ id: 'tenant-a' }, { id: 'tenant-b' }];
const statements: { query: string; tenantId: string }[] = [];
const client = Object.assign(
  async (parts: TemplateStringsArray, tenantId: string) => {
    const query = parts.join('?');
    statements.push({ query, tenantId });
    return query.includes('delete from weather_alerts') ? [{ id: 'one' }] : [{ total: 1 }];
  },
  { end: vi.fn() },
);
vi.mock('./db-client.js', () => ({ makeJobDb: () => ({ db: { select: () => ({ from: async () => rows }) }, client }) }));

import { runWeatherRetention } from './weather-retention.js';

afterEach(() => {
  delete process.env.ENABLE_WEATHER_RETENTION;
  statements.length = 0;
  client.end.mockClear();
});

describe('weather retention', () => {
  it('reports eligible rows without deleting by default', async () => {
    expect(await runWeatherRetention(new Date('2026-11-15T00:00:00Z'))).toEqual({ eligible: 2, deleted: 0 });
    expect(statements.every((s) => s.query.includes('tenant_id = ?') && !s.query.includes('delete from'))).toBe(true);
  });

  it('deletes only old rows in tenant-scoped batches when enabled', async () => {
    process.env.ENABLE_WEATHER_RETENTION = 'true';
    expect(await runWeatherRetention(new Date('2026-11-15T00:00:00Z'))).toEqual({ eligible: 2, deleted: 2 });
    expect(statements.filter((s) => s.query.includes('delete from weather_alerts')).map((s) => s.tenantId)).toEqual(['tenant-a', 'tenant-b']);
  });
});
