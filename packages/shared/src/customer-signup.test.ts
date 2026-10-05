import { describe, expect, it } from 'vitest';
import { CustomerSignupSchema } from './customers.js';

const signup = { firstName: ' Ana ', lastName: ' Peña ', mobileNumber: '09171234567', email: 'ana@example.test', jobTitle: ' Engineer ', password: 'twelve chars!', acceptedTerms: true };
describe('customer signup contact fields', () => {
  it.each(['09171234567', '+639171234567', '+63 917 123 4567', '0917 123 4567'])('normalizes %s with the existing PH helper', (mobileNumber) => {
    expect(CustomerSignupSchema.parse({ ...signup, mobileNumber })).toMatchObject({ firstName: 'Ana', lastName: 'Peña', mobileNumber: '+639171234567', jobTitle: 'Engineer' });
  });
  it.each(['firstName', 'lastName', 'jobTitle'])('rejects empty and overlong %s', (field) => {
    expect(CustomerSignupSchema.safeParse({ ...signup, [field]: '   ' }).success).toBe(false);
    expect(CustomerSignupSchema.safeParse({ ...signup, [field]: 'a'.repeat(81) }).success).toBe(false);
  });
  it.each(['', '0917', '+631234567890', '08171234567'])('rejects invalid mobile %s', (mobileNumber) => {
    expect(CustomerSignupSchema.safeParse({ ...signup, mobileNumber }).success).toBe(false);
  });
  it('requires contact fields and keeps the 12-character password and terms rules', () => {
    const missing: Partial<typeof signup> = { ...signup };
    delete missing.firstName;
    expect(CustomerSignupSchema.safeParse(missing).success).toBe(false);
    expect(CustomerSignupSchema.safeParse({ ...signup, password: 'x'.repeat(11) }).success).toBe(false);
    expect(CustomerSignupSchema.safeParse({ ...signup, acceptedTerms: false }).success).toBe(false);
  });
});
