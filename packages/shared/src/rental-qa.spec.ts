import { describe, expect, it } from 'vitest';
import { DamageAssessmentCreateSchema, DamageAssessmentResolveSchema, ReturnConditionSchema, StorefrontPromotionsSchema, needsMaintenance } from './rental-qa.js';
import { BookingDeliverRequestSchema } from './bookings.js';

const promotion = { enabled: true, amount: 1250.25, unit: 'day', qualification: 'Selected equipment; minimum eight hours.' };
const assessment = {
  assignmentId: '70000000-0000-4000-8000-000000000001', agreementId: '70000000-0000-4000-8000-000000000002',
  notes: 'Cracked guard inspected on return.', evidence: 'Photographs and estimate reviewed; customer agreement recorded.',
  contractClause: 'Customer pays for proven negligent damage.', amount: 2500.25, customerAgreed: true,
};

describe('Rental QA contracts', () => {
  it.each([
    ['good', false], ['wear', false], ['servicing', true], ['damaged', true],
  ])('keeps %s maintenance classification distinct', (condition, maintenance) => {
    expect(ReturnConditionSchema.parse(condition)).toBe(condition);
    expect(needsMaintenance(condition)).toBe(maintenance);
  });
  it('preserves legacy repair flags only when no new condition is recorded', () => {
    expect(needsMaintenance(null, true)).toBe(true);
    expect(needsMaintenance(undefined, false)).toBe(false);
    expect(needsMaintenance('good', true)).toBe(false);
  });
  it('supports absent promotions and separately configured services', () => {
    expect(StorefrontPromotionsSchema.parse({ equipment: null, trucking: null })).toEqual({ equipment: null, trucking: null });
    expect(StorefrontPromotionsSchema.parse({ equipment: promotion, trucking: { ...promotion, enabled: false, unit: 'trip' } }).trucking?.enabled).toBe(false);
  });
  it.each([0, -1, 100000000.01, 1.001, Number.POSITIVE_INFINITY, Number.NaN])('rejects invalid promotional amount %s', (amount) => {
    expect(StorefrontPromotionsSchema.safeParse({ equipment: { ...promotion, amount }, trucking: null }).success).toBe(false);
  });
  it('rejects tenant fields, unsupported units, and absent or excessive qualification text', () => {
    for (const body of [
      { equipment: promotion, trucking: null, tenantId: 'another-tenant' },
      { equipment: { ...promotion, tenantId: 'another-tenant' }, trucking: null },
      { equipment: { ...promotion, unit: 'month' }, trucking: null },
      { equipment: { ...promotion, qualification: ' ' }, trucking: null },
      { equipment: { ...promotion, qualification: 'x'.repeat(241) }, trucking: null },
    ]) expect(StorefrontPromotionsSchema.safeParse(body).success).toBe(false);
  });
  it('requires the signed agreement, explicit customer agreement, exact clause input, and evidence', () => {
    expect(DamageAssessmentCreateSchema.parse(assessment).amount).toBe(2500.25);
    for (const patch of [
      { agreementId: undefined }, { customerAgreed: false }, { customerAgreed: undefined },
      { contractClause: 'short' }, { contractClause: 'x'.repeat(5001) },
      { notes: ' ' }, { notes: 'x'.repeat(2001) }, { evidence: '' }, { evidence: 'x'.repeat(2001) },
      { amount: 0 }, { amount: 1.001 }, { amount: 100000000.01 }, { tenantId: 'another-tenant' },
    ]) expect(DamageAssessmentCreateSchema.safeParse({ ...assessment, ...patch }).success).toBe(false);
  });
  it('requires a reason for Owner decisions and rejects client invoice identifiers', () => {
    expect(DamageAssessmentResolveSchema.parse({ decision: 'approved', reason: 'Evidence supports the charge.' }).decision).toBe('approved');
    expect(DamageAssessmentResolveSchema.safeParse({ decision: 'rejected', reason: ' ' }).success).toBe(false);
    expect(DamageAssessmentResolveSchema.safeParse({ decision: 'approved', reason: 'Approved', invoiceId: assessment.assignmentId }).success).toBe(false);
  });
  it('accepts legacy deployment payloads and rejects duplicate or oversized selections', () => {
    expect(BookingDeliverRequestSchema.parse({})).toEqual({});
    expect(BookingDeliverRequestSchema.parse({ assignmentIds: [assessment.assignmentId] }).assignmentIds).toEqual([assessment.assignmentId]);
    expect(BookingDeliverRequestSchema.safeParse({ assignmentIds: [assessment.assignmentId, assessment.assignmentId] }).success).toBe(false);
    expect(BookingDeliverRequestSchema.safeParse({ assignmentIds: Array.from({ length: 101 }, (_, index) => `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`) }).success).toBe(false);
  });
});
