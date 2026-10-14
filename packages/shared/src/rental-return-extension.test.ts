import { describe, expect, it } from 'vitest';
import { BookingReturnRequestSchema, ChangeRequestResolveSchema } from './bookings.js';
import { DeploymentReturnSchema } from './sites.js';

const assignmentId = '00000000-0000-4000-8000-000000000001';

describe('extension charge resolution', () => {
  it.each([0, 1, 0.29, 1234.56])('accepts a nonnegative charge with at most two decimals: %s', (chargePhp) => {
    expect(ChangeRequestResolveSchema.parse({ decision: 'approved', chargePhp, chargeReason: ' Agreed rate ' }))
      .toMatchObject({ chargePhp, chargeReason: 'Agreed rate' });
  });
  it.each([-1, 1.001, Infinity, NaN])('rejects invalid charge %s', (chargePhp) => {
    expect(ChangeRequestResolveSchema.safeParse({ decision: 'approved', chargePhp }).success).toBe(false);
  });
  it('accepts an omitted charge and rejects blank or overlong override reasons', () => {
    expect(ChangeRequestResolveSchema.safeParse({ decision: 'rejected' }).success).toBe(true);
    for (const chargeReason of ['  ', 'x'.repeat(501)]) {
      expect(ChangeRequestResolveSchema.safeParse({ decision: 'approved', chargeReason }).success).toBe(false);
    }
  });
});

describe('rental return requests', () => {
  it('keeps empty return requests compatible and accepts per-unit condition and repair details', () => {
    expect(BookingReturnRequestSchema.parse({})).toEqual({});
    expect(DeploymentReturnSchema.parse({})).toEqual({});
    expect(BookingReturnRequestSchema.parse({ units: [{ assignmentId, conditionNotes: ' Scratched ', needsRepair: true }] }))
      .toEqual({ units: [{ assignmentId, conditionNotes: 'Scratched', needsRepair: true }] });
    expect(DeploymentReturnSchema.parse({ conditionNotes: ' Scratched ', needsRepair: true }))
      .toEqual({ conditionNotes: 'Scratched', needsRepair: true });
  });
  it('requires a meaningful reason when incomplete logs are confirmed in either return path', () => {
    for (const reason of [undefined, '', '  ', 'ab']) {
      expect(BookingReturnRequestSchema.safeParse({ confirmIncompleteLogs: true, reason: reason }).success).toBe(false);
      expect(DeploymentReturnSchema.safeParse({ confirmIncompleteLogs: true, reason }).success).toBe(false);
    }
    expect(BookingReturnRequestSchema.parse({ confirmIncompleteLogs: true, reason: ' Missing paper ' }))
      .toMatchObject({ reason: 'Missing paper' });
    expect(DeploymentReturnSchema.parse({ confirmIncompleteLogs: true, reason: ' Missing paper ' }))
      .toMatchObject({ reason: 'Missing paper' });
  });
  it('bounds notes and validates unit identity and repair flags', () => {
    expect(BookingReturnRequestSchema.safeParse({ units: [{ assignmentId, conditionNotes: 'x'.repeat(2000) }] }).success).toBe(true);
    expect(DeploymentReturnSchema.safeParse({ conditionNotes: 'x'.repeat(2000) }).success).toBe(true);
    expect(BookingReturnRequestSchema.safeParse({ units: [{ assignmentId, conditionNotes: 'x'.repeat(2001) }] }).success).toBe(false);
    expect(DeploymentReturnSchema.safeParse({ conditionNotes: 'x'.repeat(2001) }).success).toBe(false);
    expect(BookingReturnRequestSchema.safeParse({ units: [{ assignmentId: 'invalid' }] }).success).toBe(false);
    expect(BookingReturnRequestSchema.safeParse({ units: [{ assignmentId, needsRepair: 'true' }] }).success).toBe(false);
    expect(DeploymentReturnSchema.safeParse({ needsRepair: 'true' }).success).toBe(false);
  });
});
