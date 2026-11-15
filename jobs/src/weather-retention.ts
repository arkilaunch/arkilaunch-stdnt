import { tenants } from '@arkilaunch/db';
import { makeJobDb } from './db-client.js';
import { runJobIfMain } from './telemetry.js';

// A dry run is the default. Incident events keep their own evidence snapshots.
export async function runWeatherRetention(now = new Date()): Promise<{ eligible: number; deleted: number }> {
  const { db, client } = makeJobDb();
  let eligible = 0;
  let deleted = 0;
  const cutoff = now.toISOString();
  try {
    for (const tenant of await db.select({ id: tenants.id }).from(tenants)) {
      const [count] = await client`
        select count(*)::int as total from weather_alerts
        where tenant_id = ${tenant.id} and effective_at < (${cutoff}::timestamptz - interval '24 months')`;
      eligible += Number(count?.total ?? 0);
      if (process.env.ENABLE_WEATHER_RETENTION !== 'true') continue;
      for (;;) {
        const removed = await client`
          with old_rows as (
            select id from weather_alerts
            where tenant_id = ${tenant.id} and effective_at < (${cutoff}::timestamptz - interval '24 months')
            order by effective_at limit 1000
          )
          delete from weather_alerts where tenant_id = ${tenant.id} and id in (select id from old_rows)
          returning id`;
        deleted += removed.length;
        if (removed.length < 1000) break;
      }
    }
    console.log(`weather-retention: ${eligible} eligible, ${deleted} deleted (${process.env.ENABLE_WEATHER_RETENTION === 'true' ? 'apply' : 'dry run'}).`);
    return { eligible, deleted };
  } finally {
    await client.end();
  }
}

runJobIfMain(import.meta.url, 'weather-retention', runWeatherRetention);
