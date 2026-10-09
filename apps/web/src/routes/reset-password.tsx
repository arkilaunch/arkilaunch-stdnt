import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { resetPassword } from '../lib/auth-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';
import { useToast } from '../components/toast.js';

// Courtesy mirror of UserPasswordSchema (min 12); the server check is authoritative.
const MIN_PASSWORD_LENGTH = 12;

// Supabase's emailed link lands here with the recovery token in the hash (#access_token=...&type=recovery),
// or #error_description=... when the link has expired.
function readRecoveryToken(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return params.get('access_token');
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [accessToken] = useState(readRecoveryToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = !!accessToken && password.length >= MIN_PASSWORD_LENGTH && !mismatch;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword({ accessToken: accessToken!, password });
      toast.success('Password changed', 'Sign in with your new password.');
      await navigate({ to: '/login' });
    } catch {
      setError('That reset link is not valid, or it has already been used. Request a new one.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Surface radius="lg" elevation="md" className="w-full max-w-md p-8">
      <h1 id="reset-heading" className="mb-1 text-heading-lg text-text">
        Choose a new password
      </h1>
      {!accessToken ? (
        <p role="alert" className="mb-6 text-sm text-text-muted">
          This reset link is invalid or has expired. Use &ldquo;Forgot password?&rdquo; on the sign-in page to get a new
          one.
        </p>
      ) : (
        <form onSubmit={onSubmit} aria-labelledby="reset-heading">
          <p className="mb-6 text-sm text-text-muted">This signs you out everywhere else.</p>
          <div className="mb-4">
            <Input
              label="New password"
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1 text-sm text-text-muted">At least {MIN_PASSWORD_LENGTH} characters.</p>
          </div>
          <Input
            label="Confirm password"
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            {...(mismatch ? { error: 'Those passwords do not match.' } : error ? { error } : {})}
          />
          <Button type="submit" loading={submitting} disabled={submitting || !canSubmit} className="mt-4 w-full">
            Set new password
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-text-muted">
        <Link to="/login" className="font-semibold text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </Surface>
  );
}

export const resetPasswordRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});
