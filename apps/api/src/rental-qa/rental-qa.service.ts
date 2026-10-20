import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { auditLogs, damageAssessments, db, equipmentAssignments, invoiceLineItems, invoices, rentalAgreements, rentals, storefrontPromotions, withTenantTx } from '@arkilaunch/db';
import { StorefrontPromotionsSchema, type DamageAssessmentCreate, type DamageAssessmentResolve, type RequestContext, type StorefrontPromotions } from '@arkilaunch/shared';
import { notifyBookingCustomer } from '../common/notify-customer.js';

@Injectable()
export class RentalQaService {
 async list(ctx: RequestContext, rentalId: string) {
  return withTenantTx(ctx, async (tx) => {
   const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId));
   if (!rental) throw new NotFoundException({ error: 'booking_not_found' });
   const assessments = await tx.select().from(damageAssessments).where(eq(damageAssessments.rentalId, rentalId)).orderBy(desc(damageAssessments.createdAt));
   const agreements = await tx.select({ id: rentalAgreements.id, body: rentalAgreements.termsBody, version: rentalAgreements.termsVersion, signedName: rentalAgreements.signedName, signedAt: rentalAgreements.signedAt }).from(rentalAgreements).where(eq(rentalAgreements.rentalId, rentalId)).orderBy(desc(rentalAgreements.signedAt));
   return { assessments, agreements };
  });
 }
 async create(ctx: RequestContext, rentalId: string, body: DamageAssessmentCreate) {
  return withTenantTx(ctx, async (tx) => {
   const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId)).for('update');
   if (!rental) throw new NotFoundException({ error: 'booking_not_found' });
   const [assignment] = await tx.select().from(equipmentAssignments).where(and(eq(equipmentAssignments.id, body.assignmentId), eq(equipmentAssignments.rentalId, rentalId)));
   const [agreement] = await tx.select().from(rentalAgreements).where(and(eq(rentalAgreements.id, body.agreementId), eq(rentalAgreements.rentalId, rentalId), eq(rentalAgreements.customerId, rental.customerId)));
   if (!assignment || assignment.status !== 'completed' || !(assignment.returnCondition === 'damaged' || (assignment.returnCondition === null && assignment.returnNeedsRepair))) throw new UnprocessableEntityException({ error: 'returned_damage_required' });
   if (!agreement || !agreement.termsBody.includes(body.contractClause)) throw new UnprocessableEntityException({ error: 'signed_contract_clause_required' });
   const [pending] = await tx.select({ id: damageAssessments.id }).from(damageAssessments).where(and(eq(damageAssessments.assignmentId, body.assignmentId), sql`${damageAssessments.status} in ('pending','approved')`));
   if (pending) throw new ConflictException({ error: 'damage_assessment_exists' });
   const [row] = await tx.insert(damageAssessments).values({ tenantId: ctx.tenantId, rentalId, assignmentId: body.assignmentId, agreementId: body.agreementId, notes: body.notes, evidence: body.evidence, contractClause: body.contractClause, amount: body.amount.toFixed(2), createdBy: ctx.userId }).returning();
   await tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'CREATE', entity: 'damage_assessments', entityId: row!.id, reason: 'Customer agreement confirmed; evidence and signed clause recorded' });
   return row;
  });
 }
 async resolve(ctx: RequestContext, rentalId: string, id: string, body: DamageAssessmentResolve) {
  if (ctx.role !== 'owner') throw new ForbiddenException({ error: 'owner_approval_required' });
  return withTenantTx(ctx, async (tx) => {
   const [assessment] = await tx.select().from(damageAssessments).where(and(eq(damageAssessments.id, id), eq(damageAssessments.rentalId, rentalId))).for('update');
   if (!assessment) throw new NotFoundException({ error: 'assessment_not_found' });
   if (assessment.status !== 'pending') throw new ConflictException({ error: 'assessment_resolved' });
   let invoiceId: string | null = null;
   if (body.decision === 'approved') {
    const [invoice] = await tx.insert(invoices).values({ tenantId: ctx.tenantId, rentalId, invoiceType: 'damage', amount: assessment.amount, status: 'issued', dueDate: new Date(Date.now()+7*86400000) }).returning();
    invoiceId = invoice!.id;
    await tx.insert(invoiceLineItems).values({ tenantId: ctx.tenantId, invoiceId, description: `Approved equipment damage: ${assessment.notes}`, quantity: '1', unitPrice: assessment.amount, amount: assessment.amount });
    await notifyBookingCustomer(tx, ctx.tenantId, rentalId, 'damage_charge_approved', { invoice_id: invoiceId, amount: assessment.amount });
   }
   const [resolved] = await tx.update(damageAssessments).set({ status: body.decision, resolvedBy: ctx.userId, resolvedAt: new Date(), reason: body.reason, invoiceId }).where(eq(damageAssessments.id,id)).returning();
   await tx.insert(auditLogs).values({ tenantId: ctx.tenantId, actorId: ctx.userId, action: 'UPDATE', entity: 'damage_assessments', entityId: id, reason: body.reason });
   return resolved;
  });
 }
 async promotions(ctx: RequestContext): Promise<StorefrontPromotions> {
  return withTenantTx(ctx, async (tx) => {
   const [row] = await tx.select().from(storefrontPromotions).where(eq(storefrontPromotions.tenantId,ctx.tenantId));
   return { equipment: row?.equipment ?? null, trucking: row?.trucking ?? null };
  });
 }
 async savePromotions(ctx: RequestContext, body: StorefrontPromotions) {
  return withTenantTx(ctx, async (tx) => {
   await tx.insert(storefrontPromotions).values({ tenantId:ctx.tenantId, ...body }).onConflictDoUpdate({ target:storefrontPromotions.tenantId, set:body });
   await tx.insert(auditLogs).values({tenantId:ctx.tenantId,actorId:ctx.userId,action:'UPDATE',entity:'storefront_promotions',entityId:ctx.tenantId});
   return body;
  });
 }
 async publicPromotions(slug: string): Promise<StorefrontPromotions> {
  const [row] = await db.execute<{ equipment: unknown; trucking: unknown }>(sql`select * from catalog_get_promotions(${slug})`);
  return StorefrontPromotionsSchema.parse({ equipment:row?.equipment ?? null, trucking:row?.trucking ?? null });
 }
}
