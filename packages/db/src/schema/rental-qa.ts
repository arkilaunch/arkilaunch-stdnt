import { pgTable, uuid, text, numeric, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantIsolationPolicy } from '../rls.js';
import { tenants, users } from './tenancy.js';
import { rentals, equipmentAssignments, rentalAgreements } from './rentals.js';
import { invoices } from './billing.js';
import type { StorefrontPromotions } from '@arkilaunch/shared';

export const storefrontPromotions = pgTable('storefront_promotions', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  equipment: jsonb('equipment').$type<StorefrontPromotions['equipment']>(),
  trucking: jsonb('trucking').$type<StorefrontPromotions['trucking']>(),
}, () => [tenantIsolationPolicy()]).enableRLS();

export const damageAssessments = pgTable('damage_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  rentalId: uuid('rental_id').notNull().references(() => rentals.id),
  assignmentId: uuid('assignment_id').notNull().references(() => equipmentAssignments.id),
  agreementId: uuid('agreement_id').notNull().references(() => rentalAgreements.id),
  notes: text('notes').notNull(), evidence: text('evidence').notNull(), contractClause: text('contract_clause').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  status: text('status').notNull().default('pending'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  reason: text('reason'),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
}, (t) => [tenantIsolationPolicy(), index('damage_assessments_tenant_rental_idx').on(t.tenantId, t.rentalId),
  check('damage_assessments_amount_chk', sql`${t.amount} > 0`),
  check('damage_assessments_status_chk', sql`${t.status} in ('pending','approved','rejected')`),
]).enableRLS();
