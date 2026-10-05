import { Logger } from '@nestjs/common';

// Supabase Auth only mails the reset link and proves inbox control; our users table stays the source of truth.
// Each address gets a passwordless shadow user in auth.users so Supabase will send to it.
const logger = new Logger('SupabaseRecovery');

function config() {
  return {
    baseUrl: (process.env.SUPABASE_URL ?? '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  };
}

// Never throws: forgot-password must answer the same whatever happens here.
export async function sendRecoveryEmail(email: string, redirectTo: string): Promise<void> {
  const { baseUrl, key } = config();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  try {
    // 422 = already registered, which is fine.
    const created = await fetch(`${baseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, email_confirm: true }),
    });
    if (!created.ok && created.status !== 422) {
      logger.warn(`shadow user create failed: ${created.status} ${await created.text()}`);
    }
    const sent = await fetch(`${baseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email }),
    });
    if (!sent.ok) logger.warn(`recover failed: ${sent.status} ${await sent.text()}`);
  } catch (err) {
    logger.warn(`recover errored: ${String(err)}`);
  }
}

// Returns the verified email for a recovery access token, or null.
export async function recoveryEmail(accessToken: string): Promise<string | null> {
  const { baseUrl, key } = config();
  const res = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { email?: string };
  return user.email?.toLowerCase() ?? null;
}

// Kills the recovery session so the emailed link can't be replayed.
export async function revokeRecovery(accessToken: string): Promise<void> {
  const { baseUrl, key } = config();
  await fetch(`${baseUrl}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  }).catch((err) => logger.warn(`logout errored: ${String(err)}`));
}
