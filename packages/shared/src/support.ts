import { z } from 'zod';

export const TICKET_CATEGORIES = ['booking_equipment', 'payment', 'equipment_issue', 'account', 'other'] as const;
export const TICKET_CATEGORY_LABELS: Record<(typeof TICKET_CATEGORIES)[number], string> = {
  booking_equipment: 'Booking Equipment', payment: 'Payment', equipment_issue: 'Equipment issue', account: 'Account', other: 'Other',
};
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const;
export const SupportIdSchema = z.uuid();
export const TicketCreateSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
  bookingId: z.uuid().optional(),
}).strict();
export const TicketPatchSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignedTo: z.uuid().nullable().optional(),
}).strict().refine((body) => Object.keys(body).length > 0, 'Choose a change');
export const TicketListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TicketCreate = z.infer<typeof TicketCreateSchema>;
export type TicketPatch = z.infer<typeof TicketPatchSchema>;
export type TicketListQuery = z.infer<typeof TicketListQuerySchema>;
export interface TicketResponse {
  id: string;
  code: string;
  createdBy: string;
  bookingId: string | null;
  category: (typeof TICKET_CATEGORIES)[number];
  subject: string;
  message: string;
  priority: (typeof TICKET_PRIORITIES)[number];
  status: (typeof TICKET_STATUSES)[number];
  assignedTo: string | null;
  agentName: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface TicketPage { items: TicketResponse[]; total: number; }
