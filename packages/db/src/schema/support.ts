import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';
import { rentals } from './rentals.js';
import type { TicketResponse } from '@arkilaunch/shared';

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  code: text('code').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  bookingId: uuid('booking_id').references(() => rentals.id),
  category: text('category').$type<TicketResponse['category']>().notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  priority: text('priority').$type<TicketResponse['priority']>().notNull().default('medium'),
  status: text('status').$type<TicketResponse['status']>().notNull().default('open'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  tenantIsolationPolicy(), unique('support_tickets_tenant_code_uq').on(t.tenantId, t.code),
  index('support_tickets_tenant_status_idx').on(t.tenantId, t.status),
  index('support_tickets_tenant_creator_idx').on(t.tenantId, t.createdBy),
  check('support_tickets_category_chk', sql`${t.category} in ('booking_equipment','payment','equipment_issue','account','other')`),
  check('support_tickets_priority_chk', sql`${t.priority} in ('low','medium','high')`),
  check('support_tickets_status_chk', sql`${t.status} in ('open','in_progress','resolved','closed')`),
  check('support_tickets_subject_chk', sql`length(trim(${t.subject})) between 1 and 120`),
  check('support_tickets_message_chk', sql`length(trim(${t.message})) between 1 and 4000`),
]).enableRLS();
