// Neon serverless Postgres client + typed helpers. The HTTP driver is built
// for Vercel functions: no pooling/socket lifecycle to manage per invocation.
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;

// Null when unconfigured so /api/health can report it instead of crashing
// every function at import time.
export const sql = url ? neon(url) : null;

export function dbReady(): boolean {
  return sql !== null;
}

function db() {
  if (!sql) throw new Error('DATABASE_URL is not set');
  return sql;
}

export interface UserRow {
  id: string;
  email: string;
  signin_method: string | null;
}

export interface SubscriptionRow {
  plan: string;
  status: string;
  current_period_end: number | null;
}

export interface SubscriptionWithStripeRow extends SubscriptionRow {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

// Look up or create the user for an email. Sign-in methods that share an email
// resolve to the same row, so plan/subscription stays attached to the person.
export async function upsertUser(email: string, signinMethod: string): Promise<UserRow> {
  const rows = await db()`
    insert into users (email, signin_method)
    values (${email}, ${signinMethod})
    on conflict (email) do update set signin_method = excluded.signin_method
    returning id, email, signin_method
  `;
  return rows[0] as UserRow;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await db()`select id, email, signin_method from users where id = ${id}`;
  return (rows[0] as UserRow) ?? null;
}

export async function getSubscription(userId: string): Promise<SubscriptionRow> {
  const rows = await db()`
    select plan, status, current_period_end
    from subscriptions where user_id = ${userId}
  `;
  // No row yet means a signed-in free user; report that shape without writing.
  return (rows[0] as SubscriptionRow) ?? { plan: 'free', status: 'active', current_period_end: null };
}

export async function getSubscriptionWithStripe(userId: string): Promise<SubscriptionWithStripeRow> {
  const rows = await db()`
    select plan, status, current_period_end, stripe_customer_id, stripe_subscription_id
    from subscriptions where user_id = ${userId}
  `;
  return (rows[0] as SubscriptionWithStripeRow) ?? {
    plan: 'free',
    status: 'active',
    current_period_end: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
  };
}

export async function upsertUserWithStripe(
  email: string,
  signinMethod: string,
  stripeCustomerId?: string,
): Promise<UserRow> {
  const rows = await db()`
    insert into users (email, signin_method)
    values (${email}, ${signinMethod})
    on conflict (email) do update set signin_method = excluded.signin_method
    returning id, email, signin_method
  `;
  const user = rows[0] as UserRow;

  if (stripeCustomerId) {
    await db()`
      insert into subscriptions (user_id, stripe_customer_id)
      values (${user.id}, ${stripeCustomerId})
      on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id
    `;
  }

  return user;
}

export async function updateSubscriptionFromStripe(
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  plan: string,
  status: string,
  currentPeriodEndUnix: number,
): Promise<void> {
  const currentPeriodEndMs = currentPeriodEndUnix * 1000;
  await db()`
    update subscriptions
    set stripe_subscription_id = ${stripeSubscriptionId},
        plan = ${plan},
        status = ${status},
        current_period_end = ${currentPeriodEndMs},
        updated_at = now()
    where stripe_customer_id = ${stripeCustomerId}
  `;
}

// Web-only usage ingest. Idempotent: a replayed submission is dropped silently.
export async function insertUsageLog(row: {
  user_id: string | null;
  install_id: string | null;
  submission_id: string | null;
  kind: string | null;
  payload: unknown;
}): Promise<void> {
  await db()`
    insert into usage_logs (user_id, install_id, submission_id, kind, payload)
    values (${row.user_id}, ${row.install_id}, ${row.submission_id}, ${row.kind}, ${JSON.stringify(row.payload)})
    on conflict (install_id, submission_id) do nothing
  `;
}

// Phase 0 revocation: mark a JTI as revoked (kills that token across all surfaces).
export async function revokeJti(jti: string, userId: string): Promise<void> {
  await db()`
    insert into revoked_jtis (jti, user_id, revoked_at)
    values (${jti}, ${userId}, now())
    on conflict (jti) do nothing
  `;
}

// Check if a JTI has been revoked.
export async function isJtiRevoked(jti: string): Promise<boolean> {
  const rows = await db()`select 1 from revoked_jtis where jti = ${jti}`;
  return rows.length > 0;
}

// Revoke all JTIs for a user (sign-out; kills all sessions cross-surface).
export async function revokeAllForUser(userId: string): Promise<void> {
  await db()`
    insert into revoked_jtis (jti, user_id, revoked_at)
    select jti, user_id, now() from refresh_tokens
    where user_id = ${userId} and revoked_at is null
    on conflict (jti) do update set revoked_at = now()
  `;
  await db()`
    update refresh_tokens
    set revoked_at = now()
    where user_id = ${userId} and revoked_at is null
  `;
}

// Store a refresh token hash in the DB (for revocation checks). Hash is sha256(token).
export async function storeRefreshToken(
  jti: string,
  userId: string,
  tokenHash: string,
  aud: 'desktop' | 'web' | 'cloud',
  expiresAtUnix: number,
): Promise<void> {
  const expiresAt = new Date(expiresAtUnix * 1000);
  await db()`
    insert into refresh_tokens (jti, user_id, token_hash, aud, expires_at)
    values (${jti}, ${userId}, ${tokenHash}, ${aud}, ${expiresAt})
    on conflict (jti) do nothing
  `;
}

// Check if a refresh token is still valid (not revoked, not expired).
export async function isRefreshTokenValid(jti: string): Promise<boolean> {
  const rows = await db()`
    select 1 from refresh_tokens
    where jti = ${jti} and revoked_at is null and expires_at > now()
  `;
  return rows.length > 0;
}

export interface OAuthNonceData {
  code_verifier: string;
  install_id: string;
  local_port: string;
  redirect_to: string;
  client: string;
  signin_nonce: string;
}

// Phase 1 OAuth: store a CSRF nonce + PKCE verifier + handoff metadata for a sign-in
// request (one-time use, 10-min TTL). The callback recovers everything from here, so
// the OAuth `state` param only needs to carry the opaque nonce.
export async function storeOAuthNonce(nonce: string, data: OAuthNonceData): Promise<void> {
  await db()`
    insert into oauth_nonces (nonce, code_verifier, install_id, local_port, redirect_to, client, signin_nonce)
    values (${nonce}, ${data.code_verifier}, ${data.install_id}, ${data.local_port},
            ${data.redirect_to}, ${data.client}, ${data.signin_nonce})
    on conflict (nonce) do nothing
  `;
}

// Look up and consume an OAuth nonce (delete on read; single-use).
export async function consumeOAuthNonce(nonce: string): Promise<OAuthNonceData | null> {
  const rows = await db()`
    delete from oauth_nonces
    where nonce = ${nonce} and created_at > now() - interval '10 minutes'
    returning code_verifier, install_id, local_port, redirect_to, client, signin_nonce
  `;
  return (rows[0] as OAuthNonceData) ?? null;
}

// ---------------------------------------------------------------------------
// Device authorization grant (RFC 8628)
// ---------------------------------------------------------------------------

export interface DeviceCodeRow {
  device_code: string;
  user_code: string;
  user_id: string | null;
  status: string; // 'pending' | 'approved' | 'denied'
  aud: string;
  install_id: string;
  interval_sec: number;
  expires_at: string; // ISO from pg
  last_polled_at: string | null;
}

// Create a pending device-code request. expiresAtUnix is seconds since epoch.
export async function createDeviceCode(args: {
  deviceCode: string;
  userCode: string;
  aud: 'desktop' | 'web' | 'cloud';
  installId: string;
  intervalSec: number;
  expiresAtUnix: number;
}): Promise<void> {
  const expiresAt = new Date(args.expiresAtUnix * 1000);
  await db()`
    insert into device_codes (device_code, user_code, aud, install_id, interval_sec, expires_at)
    values (${args.deviceCode}, ${args.userCode}, ${args.aud}, ${args.installId},
            ${args.intervalSec}, ${expiresAt})
  `;
}

// Look up a request by its (secret) device_code, for the polling endpoint.
export async function getDeviceCodeByDeviceCode(deviceCode: string): Promise<DeviceCodeRow | null> {
  const rows = await db()`
    select device_code, user_code, user_id, status, aud, install_id,
           interval_sec, expires_at, last_polled_at
    from device_codes where device_code = ${deviceCode}
  `;
  return (rows[0] as DeviceCodeRow) ?? null;
}

// Look up a request by the human-entered user_code, for the approval page.
export async function getDeviceCodeByUserCode(userCode: string): Promise<DeviceCodeRow | null> {
  const rows = await db()`
    select device_code, user_code, user_id, status, aud, install_id,
           interval_sec, expires_at, last_polled_at
    from device_codes where user_code = ${userCode}
  `;
  return (rows[0] as DeviceCodeRow) ?? null;
}

// Record a poll attempt; used to enforce the minimum poll interval (slow_down).
export async function touchDeviceCodePoll(deviceCode: string): Promise<void> {
  await db()`update device_codes set last_polled_at = now() where device_code = ${deviceCode}`;
}

// Bind a signed-in user to a pending user_code (the approval step). Only flips a
// still-pending, unexpired row; returns true when exactly one row was approved.
export async function approveDeviceCode(userCode: string, userId: string): Promise<boolean> {
  const rows = await db()`
    update device_codes
    set status = 'approved', user_id = ${userId}, approved_at = now()
    where user_code = ${userCode} and status = 'pending' and expires_at > now()
    returning device_code
  `;
  return rows.length > 0;
}

// Reject a pending user_code (explicit user deny). Returns true when it flipped.
export async function denyDeviceCode(userCode: string): Promise<boolean> {
  const rows = await db()`
    update device_codes
    set status = 'denied'
    where user_code = ${userCode} and status = 'pending'
    returning device_code
  `;
  return rows.length > 0;
}

// Delete an approved request once the desktop has redeemed it for tokens
// (single-use), and opportunistically sweep expired rows.
export async function deleteDeviceCode(deviceCode: string): Promise<void> {
  await db()`delete from device_codes where device_code = ${deviceCode}`;
  await db()`delete from device_codes where expires_at < now()`;
}
