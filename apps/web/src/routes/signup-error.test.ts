import { describe, expect, it } from 'vitest';
import { signupError } from './signup.js';

describe('signupError', () => {
  it('tells a removed person why their email is blocked', () => {
    expect(signupError('email_disabled')).toMatch(/access was removed/);
    expect(signupError('email_taken')).toMatch(/already has an account/);
  });
});
