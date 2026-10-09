import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_REPORT_DAYS = 366;

export const LeakageReportQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    customerId: z.string().uuid().optional(),
    equipmentTypeId: z.string().uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must be on or before to', path: ['from'] })
  .refine(
    (q) => !q.from || !q.to || (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_REPORT_DAYS,
    { message: `range is at most ${MAX_REPORT_DAYS} days`, path: ['to'] },
  );
export type LeakageReportQuery = z.infer<typeof LeakageReportQuerySchema>;

// QA 35: the report is a list of leaks in pesos, ranked by what they cost, each with why it matters and what to do.
// lost = earned but will never be billed unless someone acts; delayed = billed or billable, cash not in yet;
// opportunity = capacity that earned nothing (not money owed, but money the yard could have made).
export type LeakageKind = 'lost' | 'delayed' | 'opportunity';
export type LeakageSeverity = 'high' | 'medium' | 'low';

export interface LeakageRecord {
  label: string;
  detail: string;
  amountPhp: number;
}

export interface LeakageFinding {
  key: string;
  title: string;
  kind: LeakageKind;
  severity: LeakageSeverity;
  amountPhp: number;
  count: number;
  /** Plain words for the owner: why this costs the business money. */
  whyItMatters: string;
  /** The next step that recovers or prevents it. */
  whatToDo: string;
  /** How the peso figure was worked out, so nobody has to trust a black box. */
  howMeasured: string;
  /** The biggest offenders, largest first (at most 5). */
  records: LeakageRecord[];
}

export interface LeakageKpi {
  label: string;
  value: number | null;
  unit: 'php' | 'pct' | 'days';
  meaning: string;
}

export interface LeakageReport {
  period: { from: string; to: string };
  filters: { customer: string | null; equipmentType: string | null };
  generatedAt: string;
  summary: {
    invoiced: number;
    collected: number;
    outstanding: number;
    collectionRatePct: number | null;
    verifiedRevenue: number;
    /** Money at risk this period, by kind; total = lost + delayed + opportunity. */
    atRisk: { total: number; lost: number; delayed: number; opportunity: number };
    /** The three biggest leaks' next steps, in order. */
    topActions: { title: string; amountPhp: number; whatToDo: string }[];
  };
  kpis: LeakageKpi[];
  findings: LeakageFinding[];
  master: {
    fleetTotal: number;
    fleetByStatus: Record<string, number>;
    maintenanceDue: number;
    customersTotal: number;
    customersKycApproved: number;
    projectSites: number;
  };
  ledger: {
    bookings: { count: number; byStatus: Record<string, number> };
    quotations: number;
    truckTrips: number;
    invoicesByType: Record<string, number>;
    payments: { count: number; paid: number };
    depositDeductions: { count: number; amount: number };
  };
}
