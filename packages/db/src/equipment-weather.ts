import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Executor } from './with-tenant-tx.js';
import {
  compareReportedWeather,
  DEFAULT_AM_WINDOW,
  DEFAULT_PM_WINDOW,
  estimatePagasa,
  evaluateEquipmentWeather,
  heatIndexC,
  LEVEL_RANK,
  weatherClassFor,
  worstLevel,
  type EquipmentWeather,
  type RainfallWarning,
  type ReportedWeatherDay,
  type TimedReading,
  type WeatherDiscrepancy,
  type WeatherLevel,
  type WeatherObservation,
  workedInReportedWeather,
  weatherCoverage,
} from '@arkilaunch/shared';
import { customers } from './schema/customers.js';
import { equipment, equipmentTypes } from './schema/fleet.js';
import { equipmentAssignments, rentals } from './schema/rentals.js';
import { edtr, edtrLineItems } from './schema/billing.js';
import { events } from './schema/events.js';
import { weatherAlerts } from './schema/weather.js';
import { notifySiteWeather } from './weather-notify.js';

// Shared by the weather poll (service_role: every query names the tenant explicitly) and the API (RLS).

export interface PagasaInForce {
  tcws: number;
  rainfall: RainfallWarning;
  thunderstorm: boolean;
  validUntil: string;
}

export async function machinesOnSite(ex: Executor, tenantId: string, siteId: string) {
  return ex
    .select({
      equipmentId: equipment.id,
      rentalId: equipmentAssignments.rentalId,
      customerId: rentals.customerId,
      model: equipment.model,
      typeName: equipmentTypes.name,
    })
    .from(equipmentAssignments)
    .innerJoin(rentals, eq(rentals.id, equipmentAssignments.rentalId))
    .innerJoin(equipment, eq(equipment.id, equipmentAssignments.equipmentId))
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, equipment.equipmentTypeId))
    .where(
      and(
        eq(equipmentAssignments.tenantId, tenantId),
        eq(rentals.projectSiteId, siteId),
        eq(equipmentAssignments.status, 'active'),
      ),
    );
}

export interface SiteEquipmentLevels {
  level: WeatherLevel;
  equipment: EquipmentWeather[];
  pagasa: PagasaInForce | null;
}

export async function evaluateSiteEquipment(
  ex: Executor,
  tenantId: string,
  siteId: string,
  observed: WeatherObservation,
  now = new Date(),
  preloaded?: Awaited<ReturnType<typeof machinesOnSite>>,
): Promise<SiteEquipmentLevels> {
  const estimate = estimatePagasa(observed);
  const pagasa: PagasaInForce = { ...estimate, validUntil: new Date(now.getTime() + 30 * 60_000).toISOString() };
  const inputs = {
    windKph: observed.windKph,
    gustKph: observed.gustKph ?? null,
    // Current precipitation read as the rain rate PAGASA colours are defined on (mm/h).
    rainMmPerHour: observed.precipMm,
    heatIndexC: observed.humidityPct !== undefined ? heatIndexC(observed.tempC, observed.humidityPct) : null,
    thunderstorm: pagasa.thunderstorm,
    tcws: pagasa.tcws,
    pagasaRainfall: pagasa.rainfall,
  };
  const machines = preloaded ?? (await machinesOnSite(ex, tenantId, siteId));
  const levels: EquipmentWeather[] = machines.map((m) => {
    const weatherClass = weatherClassFor(m.typeName);
    const result = evaluateEquipmentWeather(weatherClass, inputs);
    return {
      equipmentId: m.equipmentId,
      rentalId: m.rentalId,
      equipmentName: m.model,
      equipmentType: m.typeName,
      weatherClass,
      level: result.level,
      reasons: result.reasons,
    };
  });
  return { level: worstLevel(levels.map((l) => l.level)), equipment: levels, pagasa };
}

// A calendar day in the Philippines (UTC+8, no DST) as a UTC window.
function manilaDay(date: string): { from: Date; to: Date } {
  const from = new Date(`${date}T00:00:00+08:00`);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

export type WorkHalf = 'am' | 'pm';
export interface WorkWindows {
  am?: [number, number] | null | undefined;
  pm?: [number, number] | null | undefined;
}

type UsedDespiteSource = 'system' | 'sheet';

async function edtrIncidentContext(ex: Executor, tenantId: string, edtrId: string) {
  const [row] = await ex
    .select({
      rentalId: edtr.rentalId,
      equipmentId: edtr.equipmentId,
      reportDate: edtr.reportDate,
      siteId: rentals.projectSiteId,
      equipmentName: equipment.model,
      companyName: customers.companyName,
    })
    .from(edtr)
    .innerJoin(rentals, eq(rentals.id, edtr.rentalId))
    .innerJoin(equipment, eq(equipment.id, edtr.equipmentId))
    .innerJoin(customers, eq(customers.id, rentals.customerId))
    .where(and(eq(edtr.id, edtrId), eq(edtr.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  const [hours] = await ex
    .select({ active: sql<string>`coalesce(sum(${edtrLineItems.hoursActive}), 0)` })
    .from(edtrLineItems)
    .where(and(eq(edtrLineItems.edtrId, edtrId), eq(edtrLineItems.tenantId, tenantId)));
  return { ...row, reportDate: String(row.reportDate), hoursActive: Number(hours?.active ?? 0) };
}
type EdtrIncidentContext = NonNullable<Awaited<ReturnType<typeof edtrIncidentContext>>>;

// One incident per EDTR and source; tenant admins are told when it is first logged. Evidence only (RFC-2).
async function logUsedDespiteWarning(
  ex: Executor,
  tenantId: string,
  edtrId: string,
  ctx: EdtrIncidentContext,
  source: UsedDespiteSource,
  details: Record<string, unknown> & { half: WorkHalf | 'day'; halves: string[] },
): Promise<boolean> {
  const [already] = await ex
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.tenantId, tenantId),
        eq(events.name, 'equipment_used_despite_warning'),
        sql`${events.properties} ->> 'edtr_id' = ${edtrId}`,
        // Incidents logged before the sheet source existed have no source: they came from the system warning.
        sql`coalesce(${events.properties} ->> 'source', 'system') = ${source}`,
      ),
    )
    .limit(1);
  if (already) return false;
  const properties = {
    edtr_id: edtrId,
    rental_id: ctx.rentalId,
    project_site_id: ctx.siteId,
    equipment_id: ctx.equipmentId,
    date: ctx.reportDate,
    hours_active: ctx.hoursActive,
    source,
    ...details,
  };
  const [incident] = await ex
    .insert(events)
    .values({ tenantId, name: 'equipment_used_despite_warning', properties })
    .returning({ id: events.id });
  await notifySiteWeather(
    ex,
    tenantId,
    ctx.siteId,
    'equipment_used_despite_warning',
    { ...properties, incident_id: incident!.id, equipment_name: ctx.equipmentName, company_name: ctx.companyName },
    [],
    ['staff'],
  );
  return true;
}

// Returns the halves with a recorded stop-work level during work, once per EDTR.
export async function flagUsedDespiteWarning(
  ex: Executor,
  tenantId: string,
  edtrId: string,
  windows: WorkWindows = {},
): Promise<WorkHalf[]> {
  const ctx = await edtrIncidentContext(ex, tenantId, edtrId);
  if (!ctx || ctx.hoursActive <= 0) return [];

  const site = await siteReadingsOn(ex, tenantId, ctx.rentalId, ctx.reportDate);
  if (!site) return [];
  const worked: [WorkHalf, [number, number]][] = [
    ['am', windows.am ?? DEFAULT_AM_WINDOW],
    ['pm', windows.pm ?? DEFAULT_PM_WINDOW],
  ];
  const machineReadings = site.readings.filter((reading) =>
    ((reading.observed as WeatherObservation & { equipment?: EquipmentWeather[] }).equipment ?? [])
      .some((machine) => machine.equipmentId === ctx.equipmentId),
  );
  const warned = machineReadings.filter((reading) => {
    const machines = (reading.observed as WeatherObservation & { equipment?: EquipmentWeather[] }).equipment ?? [];
    return machines.some((machine) => machine.equipmentId === ctx.equipmentId && machine.level === 'stop_work');
  });
  const halves = worked
    .filter(([, window]) => weatherCoverage(machineReadings, window).sufficient && warned.some((reading) => reading.minute >= window[0] && reading.minute < window[1]))
    .map(([half]) => half);
  if (halves.length === 0) return [];

  const first = warned.find((reading) => halves.some((half) => {
    const window = half === 'am' ? worked[0]![1] : worked[1]![1];
    return reading.minute >= window[0] && reading.minute < window[1];
  }))!;
  const machine = ((first.observed as WeatherObservation & { equipment?: EquipmentWeather[] }).equipment ?? [])
    .find((item) => item.equipmentId === ctx.equipmentId);
  const { from } = manilaDay(ctx.reportDate);
  const logged = await logUsedDespiteWarning(ex, tenantId, edtrId, ctx, 'system', {
    level: 'stop_work',
    reasons: machine?.reasons ?? [],
    warned_at: new Date(from.getTime() + first.minute * 60_000).toISOString(),
    half: halves.length === 2 ? 'day' : halves[0]!,
    halves,
  });
  return logged ? halves : [];
}

// The sheet's own HR/W/T tick against its running hours: no weather feed needed. Once per EDTR.
export async function flagWorkedInReportedWeather(
  ex: Executor,
  tenantId: string,
  edtrId: string,
  day: ReportedWeatherDay,
): Promise<(WorkHalf | 'day')[]> {
  const halves = workedInReportedWeather(day);
  if (halves.length === 0) return [];
  const ctx = await edtrIncidentContext(ex, tenantId, edtrId);
  if (!ctx) return [];
  const logged = await logUsedDespiteWarning(ex, tenantId, edtrId, ctx, 'sheet', {
    reported: { am: day.weatherAm, pm: day.weatherPm },
    weather_hours: day.weatherHours ?? null,
    half: halves.length === 1 ? halves[0]! : 'day',
    halves,
  });
  return logged ? halves : [];
}

// Every weather check on one field-log day, for the OCR worker and typed entries alike.
// Appends the review flags it raised and returns them; the caller decides whether to hold the day. Never money (RFC-2).
export async function flagEdtrWeather(
  ex: Executor,
  tenantId: string,
  edtrId: string,
  rentalId: string,
  reportDate: string,
  day: ReportedWeatherDay,
): Promise<string[]> {
  const system = await flagUsedDespiteWarning(ex, tenantId, edtrId, { am: day.amWindow, pm: day.pmWindow });
  const sheet = await flagWorkedInReportedWeather(ex, tenantId, edtrId, day);
  const discrepancies = await logWeatherDiscrepancies(ex, tenantId, edtrId, rentalId, reportDate, day);
  const flags = [
    ...new Set(discrepancies.map((f) => `weather_${f.rule}`)),
    ...system.map((half) => `used_despite_stop_work_${half}`),
    ...sheet.map((half) => `worked_in_reported_weather_${half}`),
  ];
  if (flags.length > 0) {
    await ex
      .update(edtrLineItems)
      .set({ reviewFlags: sql`${edtrLineItems.reviewFlags} || ${JSON.stringify(flags)}::jsonb` })
      .where(and(eq(edtrLineItems.edtrId, edtrId), eq(edtrLineItems.tenantId, tenantId)));
  }
  return flags;
}

// A level that stays up does not re-notify every poll.
export async function warnOnEquipmentEscalation(
  ex: Executor,
  tenantId: string,
  siteId: string,
  previous: EquipmentWeather[] | null,
  current: EquipmentWeather[],
  siteName?: string,
): Promise<number> {
  const before = new Map((previous ?? []).map((m) => [m.equipmentId, m.level]));
  const risen = current.filter(
    (m) => LEVEL_RANK[m.level] >= LEVEL_RANK.caution && LEVEL_RANK[m.level] > LEVEL_RANK[before.get(m.equipmentId) ?? 'normal'],
  );
  for (const machine of risen) {
    const payload = {
      project_site_id: siteId,
      ...(siteName ? { site_name: siteName } : {}),
      rental_id: machine.rentalId,
      equipment_id: machine.equipmentId,
      equipment_name: machine.equipmentName,
      equipment_type: machine.equipmentType,
      level: machine.level,
      reasons: machine.reasons,
    };
    const recipients = await notifySiteWeather(ex, tenantId, siteId, 'equipment_weather_warning', payload, [machine.rentalId]);
    await ex.insert(events).values({ tenantId, name: 'equipment_weather_warning', properties: { ...payload, notified: recipients.length } });
  }
  return risen.length;
}

export async function siteReadingsOn(
  ex: Executor,
  tenantId: string,
  rentalId: string,
  reportDate: string,
): Promise<{ siteId: string; readings: TimedReading[] } | null> {
  const [rental] = await ex
    .select({ siteId: rentals.projectSiteId })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.tenantId, tenantId)))
    .limit(1);
  if (!rental?.siteId) return null;
  const { from, to } = manilaDay(reportDate);
  const rows = await ex
    .select({ at: weatherAlerts.effectiveAt, observed: weatherAlerts.observed })
    .from(weatherAlerts)
    .where(
      and(
        eq(weatherAlerts.tenantId, tenantId),
        eq(weatherAlerts.projectSiteId, rental.siteId),
        gte(weatherAlerts.effectiveAt, from),
        lt(weatherAlerts.effectiveAt, to),
      ),
    );
  const readings = rows
    .filter((r) => r.observed)
    .map((r) => ({ minute: Math.floor((r.at.getTime() - from.getTime()) / 60_000), observed: r.observed as WeatherObservation }));
  return { siteId: rental.siteId, readings };
}

// Evidence only: never touches money or the EDTR's status (RFC-2); the caller decides whether to hold the day.
export async function logWeatherDiscrepancies(
  ex: Executor,
  tenantId: string,
  edtrId: string,
  rentalId: string,
  reportDate: string,
  day: ReportedWeatherDay,
): Promise<WeatherDiscrepancy[]> {
  const site = await siteReadingsOn(ex, tenantId, rentalId, reportDate);
  if (!site) return [];
  const flags = compareReportedWeather(day, site.readings);
  for (const flag of flags) {
    const [already] = await ex
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.name, 'edtr_weather_discrepancy'),
          sql`${events.properties} ->> 'edtr_id' = ${edtrId}`,
          sql`${events.properties} ->> 'rule' = ${flag.rule}`,
          sql`${events.properties} ->> 'half' = ${flag.half}`,
        ),
      )
      .limit(1);
    if (already) continue;
    await ex.insert(events).values({
      tenantId,
      name: 'edtr_weather_discrepancy',
      properties: {
        edtr_id: edtrId,
        rental_id: rentalId,
        project_site_id: site.siteId,
        date: reportDate,
        half: flag.half,
        rule: flag.rule,
        reported: flag.reported,
        system: flag.system,
        readings: site.readings
          .map((r) => ({ minute: r.minute, precip_mm: r.observed.precipMm, wind_kph: r.observed.windKph, code: r.observed.code }))
          .sort((a, b) => a.minute - b.minute),
      },
    });
  }
  return flags;
}
