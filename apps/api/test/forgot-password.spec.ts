import { afterEach, describe, expect, it, vi } from 'vitest';
import { verify } from '@node-rs/argon2';
import { JwtService } from '@nestjs/jwt';
import postgres from 'postgres';
import { AuthService } from '../src/auth/auth.service.js';
import { RefreshTokenService } from '../src/auth/refresh-token.service.js';
import { TotpService } from '../src/auth/totp.service.js';

function jwtService(): JwtService {
  const publicKey = process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n');
  const privateKey = process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n');
  return new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
}

const auth = new AuthService(jwtService(), new RefreshTokenService(), new TotpService());

// Supabase Auth is stubbed: /auth/v1/user answers with `email` for the token 'good', 401 otherwise.
function stubSupabase(email: string) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) {
      const ok = (init?.headers as Record<string, string>).Authorization === 'Bearer good';
      return new Response(ok ? JSON.stringify({ email }) : '{}', { status: ok ? 200 : 401 });
    }
    return new Response('{}', { status: 200 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('AuthService.forgotPassword', () => {
  it('asks Supabase to email a known active account, and only that one', async () => {
    const calls = stubSupabase('');
    await auth.forgotPassword({ email: `nobody-${Date.now()}@example.test` }, 'test-tenant-a');
    expect(calls).toEqual([]);
    await auth.forgotPassword({ email: 'timekeeper@test-tenant-a.test' }, 'test-tenant-a');
    expect(calls.some((u) => u.includes('/auth/v1/recover?redirect_to=') && u.includes('reset-password'))).toBe(true);
  });

  it('answers the same for an unknown and a known email', async () => {
    stubSupabase('');
    const unknown = await auth.forgotPassword({ email: `nobody-${Date.now()}@example.test` }, 'test-tenant-a');
    const known = await auth.forgotPassword({ email: 'Timekeeper@test-tenant-a.test' }, 'test-tenant-a');
    expect(unknown).toEqual({ ok: true });
    expect(known).toEqual(unknown);
  });

  it("alerts the account's own tenant admins, not another tenant's", async () => {
    stubSupabase('');
    await auth.forgotPassword({ email: 'timekeeper@test-tenant-a.test' }, 'test-tenant-a');
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    try {
      const rows = await sql<{ email: string }[]>`
        select u.email from notifications n join users u on u.id = n.user_id
        where n.notification_type = 'password_reset_requested'
          and n.payload->>'email' = 'timekeeper@test-tenant-a.test'
          and n.created_at >= now() - interval '1 minute'
      `;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.email).toMatch(/@test-tenant-a\.test$/);
    } finally {
      await sql.end();
    }
  });
});

describe('AuthService.resetPassword', () => {
  const email = 'timekeeper@test-tenant-a.test';
  const password = 'Timekeeper-reset-123';

  it('rejects a token Supabase does not vouch for', async () => {
    stubSupabase(email);
    await expect(auth.resetPassword({ accessToken: 'bad', password }, 'test-tenant-a')).rejects.toThrow(
      'invalid_reset_token',
    );
  });

  it("rejects a verified email on another tenant's host", async () => {
    stubSupabase(email);
    await expect(auth.resetPassword({ accessToken: 'good', password }, 'test-tenant-b')).rejects.toThrow(
      'invalid_reset_token',
    );
  });

  it('sets the new password and revokes every session', async () => {
    stubSupabase(email);
    const sql = postgres(process.env.DATABASE_URL_DIRECT!, { max: 1 });
    try {
      const [before] = await sql<{ password_hash: string }[]>`select password_hash from users where email = ${email}`;
      await expect(auth.resetPassword({ accessToken: 'good', password }, 'test-tenant-a')).resolves.toEqual({ ok: true });
      const [user] = await sql<{ id: string; password_hash: string }[]>`select id, password_hash from users where email = ${email}`;
      expect(await verify(user!.password_hash, password)).toBe(true);
      const live = await sql`select 1 from refresh_tokens where user_id = ${user!.id} and status <> 'revoked'`;
      expect(live.length).toBe(0);
      // Put the seed password back so other specs still log in.
      await sql`update users set password_hash = ${before!.password_hash} where id = ${user!.id}`;
    } finally {
      await sql.end();
    }
  });
});
