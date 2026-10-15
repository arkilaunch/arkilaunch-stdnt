import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { CustomerSignupSchema } from '@arkilaunch/shared';
import { authLayoutRoute } from './_auth.js';
import { registerCustomer } from '../lib/auth-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';
import { captchaError, Turnstile, TURNSTILE_SITE_KEY } from '../components/turnstile.js';
import { onlyOn, redirectIfSignedIn } from '../lib/guards.js';
import { platformOrigin } from '../lib/host.js';

const MIN_PASSWORD = 12;

export function signupError(code: string): string {
  const captcha = captchaError(code);
  if (captcha) return captcha;
  if (code === 'email_disabled') return "This email's access was removed. Ask the company to restore it.";
  if (code === 'email_taken') return 'That email already has an account. Log in instead.';
  if (code === 'signup_unavailable') return 'Sign-up is not open on this site yet.';
  return 'We could not create your account. Check the details and try again.';
}

function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const waitingOnCaptcha = Boolean(TURNSTILE_SITE_KEY) && !captcha;

  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mismatch || !accepted || waitingOnCaptcha) return;
    const parsed = CustomerSignupSchema.safeParse({ firstName, lastName, mobileNumber, email, jobTitle, password, acceptedTerms: true });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    if (confirm !== password || !confirm) { setFieldErrors({ confirm: 'Confirm your password.' }); return; }
    setFieldErrors({});
    setBusy(true);
    setError(null);
    try {
      await registerCustomer(parsed.data, captcha);
      await navigate({ to: '/equipment', replace: true });
    } catch (err) {
      setError(signupError(err instanceof Error ? err.message : ''));
      // The token was spent on this attempt; get a fresh one.
      setCaptcha(null);
      setCaptchaKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface radius="lg" elevation="md" className="w-full max-w-md p-8">
      <form noValidate onSubmit={onSubmit} aria-labelledby="signup-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="signup-heading" className="text-heading-lg text-text">
            Create account
          </h1>
          <p className="text-sm text-text-muted">Browse and price equipment right away. Verify your company when you are ready to book.</p>
        </div>
        <Input label="First name" autoComplete="given-name" required maxLength={80} value={firstName} onChange={(e) => setFirstName(e.target.value)} error={fieldErrors.firstName} />
        <Input label="Last name" autoComplete="family-name" required maxLength={80} value={lastName} onChange={(e) => setLastName(e.target.value)} error={fieldErrors.lastName} />
        <Input label="Mobile number" type="tel" autoComplete="tel" required value={mobileNumber} onChange={(e) => { setMobileNumber(e.target.value); setFieldErrors((errors) => ({ ...errors, mobileNumber: '' })); }} error={fieldErrors.mobileNumber} hint="e.g. +63 917 123 4567" />
        <Input label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} />
        <Input label="Job title/position" autoComplete="organization-title" required maxLength={80} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} error={fieldErrors.jobTitle} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          hint={`Minimum ${MIN_PASSWORD} characters required.`}
          error={fieldErrors.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? 'Passwords do not match.' : fieldErrors.confirm}
        />
        <label className="flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            required
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            I have read and agree to the <Link to="/terms" className="underline">Terms of Service</Link> and{' '}
            <Link to="/privacy" className="underline">Privacy Policy</Link>, and I am of legal age.
          </span>
        </label>
        <Turnstile key={captchaKey} onToken={setCaptcha} />
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={busy} disabled={mismatch || !accepted || waitingOnCaptcha}>
          Create account
        </Button>
        <p className="text-center text-sm text-text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-accent hover:underline">
            Log in
          </Link>
        </p>
        <p className="text-center text-xs text-text-muted">
          Renting out equipment?{' '}
          {/* Registering a rental company is a platform action (bare domain). */}
          <a href={`${platformOrigin()}/register`} className="underline">
            Register your rental business
          </a>
        </p>
      </form>
    </Surface>
  );
}

export const signupRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  beforeLoad: onlyOn('tenant', redirectIfSignedIn),
  path: '/signup',
  component: SignupPage,
});
