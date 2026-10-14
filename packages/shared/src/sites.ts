import { z } from 'zod';
import { WeatherSeveritySchema } from './weather.js';
import { PaginationQuerySchema } from './pagination.js';

export const SiteAddressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  province: z.string().min(1).max(120),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).default('PH'),
});
export type SiteAddress = z.infer<typeof SiteAddressSchema>;

export const SiteCreateRequestSchema = z.object({
  address: SiteAddressSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type SiteCreateRequest = z.infer<typeof SiteCreateRequestSchema>;

export const SiteUpdateRequestSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine((data) => data.latitude !== undefined || data.longitude !== undefined, {
    message: 'at least one of latitude or longitude is required',
  });
export type SiteUpdateRequest = z.infer<typeof SiteUpdateRequestSchema>;

export const DeploymentCreateRequestSchema = z
  .object({
    equipmentId: z.string().uuid(),
    rentalId: z.string().uuid(),
    operatorUserId: z.string().uuid().optional(),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .refine((data) => new Date(data.end).getTime() > new Date(data.start).getTime(), {
    message: 'end must be after start',
  });
export type DeploymentCreateRequest = z.infer<typeof DeploymentCreateRequestSchema>;

export const IncidentListQuerySchema = PaginationQuerySchema.extend({
  projectSiteId: z.string().uuid().optional(),
  // 'discrepancy' (D1/D2) is not in the incident log; it is still read per field log (edtrId) for the weather check.
  kind: z.enum(['weather', 'discrepancy', 'used_despite_warning']).optional(),
  edtrId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'dismissed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const IncidentReviewRequestSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.status !== 'dismissed' || Boolean(d.note), { message: 'A dismissal needs a note', path: ['note'] });
export type IncidentReviewRequest = z.infer<typeof IncidentReviewRequestSchema>;

export const SiteDeploymentFilterSchema = z.enum(['active', 'upcoming', 'idle']);
export type SiteDeploymentFilter = z.infer<typeof SiteDeploymentFilterSchema>;
export const SiteListQuerySchema = PaginationQuerySchema.extend({
  deployment: SiteDeploymentFilterSchema.optional(),
});
export type SiteListQuery = z.infer<typeof SiteListQuerySchema>;
export type IncidentListQuery = z.infer<typeof IncidentListQuerySchema>;

const SiteBaseResponseSchema = z.object({
  id: z.string().uuid(),
  latitude: z.number(),
  longitude: z.number(),
  latestSeverity: WeatherSeveritySchema.nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  observedAt: z.string().datetime().nullable(),
});

export const SiteResponseSchema = SiteBaseResponseSchema.extend({
  activeUnits: z.number().int(),
  upcomingUnits: z.number().int(),
  nextArrival: z.string().datetime().nullable(),
  customerName: z.string().nullable(),
});
export type SiteResponse = z.infer<typeof SiteResponseSchema>;

export const SiteListResponseSchema = z.object({
  items: z.array(SiteResponseSchema),
  total: z.number().int(),
});
export type SiteListResponse = z.infer<typeof SiteListResponseSchema>;

export const SiteAddressResponseSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  province: z.string(),
  postalCode: z.string().nullable(),
  country: z.string(),
});
export type SiteAddressResponse = z.infer<typeof SiteAddressResponseSchema>;

export const SiteDetailResponseSchema = SiteBaseResponseSchema.extend({
  address: SiteAddressResponseSchema.nullable(),
});
export type SiteDetailResponse = z.infer<typeof SiteDetailResponseSchema>;

export const IncidentResponseSchema = z.object({
  id: z.string().uuid(),
  projectSiteId: z.string().uuid().nullable(),
  siteCity: z.string().nullable(),
  siteProvince: z.string().nullable(),
  severity: z.string().nullable(),
  observed: z.unknown().nullable(),
  occurredAt: z.coerce.date(),
  kind: z.enum(['weather', 'discrepancy', 'used_despite_warning']),
  detail: z.string().nullable(),
  // Set on EDTR-born incidents (discrepancy, used despite warning), so the log can open the field log.
  edtrId: z.string().uuid().nullable(),
  half: z.enum(['am', 'pm', 'day']).nullable(),
  // The renting company, through the incident's rental; null on a site-wide weather incident.
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  // Used despite warning: the system stop-work warning, or the field log's own HR/W/T tick.
  source: z.enum(['system', 'sheet']).nullable(),
  status: z.enum(INCIDENT_STATUSES),
  reviewNote: z.string().nullable(),
  reviewedAt: z.coerce.date().nullable(),
});
export type IncidentResponse = z.infer<typeof IncidentResponseSchema>;

export const IncidentListResponseSchema = z.object({
  items: z.array(IncidentResponseSchema),
  total: z.number().int(),
});

// Used-despite-warning incidents per renting company, dismissed ones left out.
export const IncidentCompanyTallyResponseSchema = z.object({
  items: z.array(
    z.object({
      customerId: z.string().uuid(),
      companyName: z.string(),
      total: z.number().int(),
      open: z.number().int(),
    }),
  ),
});
export type IncidentCompanyTallyResponse = z.infer<typeof IncidentCompanyTallyResponseSchema>;
export type IncidentListResponse = z.infer<typeof IncidentListResponseSchema>;

// Refused (409) while field-log days are unapproved or missing, unless the admin confirms with an audit-logged reason.
export const DeploymentReturnSchema = z
  .object({
    conditionNotes: z.string().trim().max(2000).optional(),
    needsRepair: z.boolean().optional(),
    confirmIncompleteLogs: z.boolean().optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((b) => !b.confirmIncompleteLogs || !!b.reason, { message: 'a reason is required', path: ['reason'] });
export type DeploymentReturnRequest = z.infer<typeof DeploymentReturnSchema>;

export const TimekeeperAssignRequestSchema = z.object({ userId: z.string().uuid() });
export type TimekeeperAssignRequest = z.infer<typeof TimekeeperAssignRequestSchema>;
