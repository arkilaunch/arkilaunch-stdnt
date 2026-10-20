import { z } from 'zod';

export const RETURN_CONDITIONS = { good: 'Good condition', wear: 'Normal wear', servicing: 'Needs servicing', damaged: 'Damaged / needs repair' } as const;
export const ReturnConditionSchema = z.enum(['good', 'wear', 'servicing', 'damaged']);
export type ReturnCondition = z.infer<typeof ReturnConditionSchema>;
export const needsMaintenance = (condition?: string | null, legacy = false): boolean => condition ? condition === 'servicing' || condition === 'damaged' : legacy;
export const PromotionSchema = z.object({ enabled: z.boolean(), amount: z.number().finite().positive().max(100000000).multipleOf(0.01), unit: z.enum(['hour', 'day', 'trip']), qualification: z.string().trim().min(1).max(240) }).strict();
export const StorefrontPromotionsSchema = z.object({ equipment: PromotionSchema.nullable(), trucking: PromotionSchema.nullable() }).strict();
export type StorefrontPromotions = z.infer<typeof StorefrontPromotionsSchema>;
export const DamageAssessmentCreateSchema = z.object({ assignmentId: z.string().uuid(), agreementId: z.string().uuid(), notes: z.string().trim().min(3).max(2000), evidence: z.string().trim().min(3).max(2000), contractClause: z.string().trim().min(10).max(5000), amount: z.number().finite().positive().max(100000000).multipleOf(0.01), customerAgreed: z.literal(true) }).strict();
export type DamageAssessmentCreate = z.infer<typeof DamageAssessmentCreateSchema>;
export const DamageAssessmentResolveSchema = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().min(3).max(1000) }).strict();
export type DamageAssessmentResolve = z.infer<typeof DamageAssessmentResolveSchema>;
