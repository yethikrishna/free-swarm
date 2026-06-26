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

// ---------------------------------------------------------------------------
// F1 Device/session management
// ---------------------------------------------------------------------------

export interface SessionRow {
  jti: string;
  aud: string;
  device_label: string;
  last_seen_at: string;
  created_at: string;
  expires_at: string;
}

// List a user's active sessions (un-revoked, unexpired refresh tokens), newest first.
export async function listSessions(userId: string): Promise<SessionRow[]> {
  const rows = await db()`
    select jti, aud, device_label, last_seen_at, created_at, expires_at
    from refresh_tokens
    where user_id = ${userId} and revoked_at is null and expires_at > now()
    order by last_seen_at desc
  `;
  return rows as SessionRow[];
}

// Bump last-seen for a session's jti (called on token refresh).
export async function touchSession(jti: string): Promise<void> {
  await db()`update refresh_tokens set last_seen_at = now() where jti = ${jti}`;
}

// Revoke one session (and blacklist its jti) if it belongs to the user. Returns
// true when a row was actually revoked, so the caller can 404 a foreign jti.
export async function revokeSession(userId: string, jti: string): Promise<boolean> {
  const rows = await db()`
    update refresh_tokens set revoked_at = now()
    where jti = ${jti} and user_id = ${userId} and revoked_at is null
    returning jti
  `;
  if (rows.length === 0) return false;
  await db()`
    insert into revoked_jtis (jti, user_id, revoked_at)
    values (${jti}, ${userId}, now())
    on conflict (jti) do update set revoked_at = now()
  `;
  return true;
}

// Label a freshly-minted refresh token's device (best-effort; called post-mint).
export async function labelSession(jti: string, deviceLabel: string): Promise<void> {
  await db()`update refresh_tokens set device_label = ${deviceLabel} where jti = ${jti}`;
}

// ---------------------------------------------------------------------------
// F2/F8 Teams + membership
// ---------------------------------------------------------------------------

export interface TeamRow {
  id: string;
  name: string;
  owner_id: string;
  role?: string;
}
export interface TeamMemberRow {
  id: string;
  user_id: string | null;
  invite_email: string;
  role: string;
  status: string;
}

export async function createTeam(ownerId: string, name: string, ownerEmail: string): Promise<TeamRow> {
  const rows = await db()`
    insert into teams (name, owner_id) values (${name}, ${ownerId})
    returning id, name, owner_id
  `;
  const team = rows[0] as TeamRow;
  // The owner is implicitly the first member with role 'owner'.
  await db()`
    insert into team_members (team_id, user_id, invite_email, role, status)
    values (${team.id}, ${ownerId}, ${ownerEmail}, 'owner', 'active')
    on conflict (team_id, invite_email) do nothing
  `;
  return team;
}

// Teams the user owns or belongs to, with the user's role in each.
export async function listTeamsForUser(userId: string, email: string): Promise<TeamRow[]> {
  const rows = await db()`
    select t.id, t.name, t.owner_id, m.role
    from teams t
    join team_members m on m.team_id = t.id
    where m.user_id = ${userId} or m.invite_email = ${email}
    order by t.created_at desc
  `;
  return rows as TeamRow[];
}

export async function getTeamRole(teamId: string, userId: string, email: string): Promise<string | null> {
  const rows = await db()`
    select role from team_members
    where team_id = ${teamId} and (user_id = ${userId} or invite_email = ${email})
    limit 1
  `;
  return rows.length ? String((rows[0] as { role: string }).role) : null;
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
  const rows = await db()`
    select id, user_id, invite_email, role, status
    from team_members where team_id = ${teamId}
    order by created_at asc
  `;
  return rows as TeamMemberRow[];
}

export async function inviteTeamMember(teamId: string, email: string, role: string): Promise<void> {
  // If the email already maps to a user, bind it now so they see the team on login.
  const u = await db()`select id from users where email = ${email}`;
  const userId = u.length ? String((u[0] as { id: string }).id) : null;
  const status = userId ? 'active' : 'invited';
  await db()`
    insert into team_members (team_id, user_id, invite_email, role, status)
    values (${teamId}, ${userId}, ${email}, ${role}, ${status})
    on conflict (team_id, invite_email) do update set role = excluded.role
  `;
}

export async function setMemberRole(teamId: string, memberId: string, role: string): Promise<void> {
  await db()`update team_members set role = ${role} where id = ${memberId} and team_id = ${teamId}`;
}

export async function removeTeamMember(teamId: string, memberId: string): Promise<void> {
  // Never remove the owner row via this path; the team would be orphaned.
  await db()`delete from team_members where id = ${memberId} and team_id = ${teamId} and role <> 'owner'`;
}

// ---------------------------------------------------------------------------
// F3 Share links
// ---------------------------------------------------------------------------

export interface SharedResourceRow {
  token: string;
  kind: string;
  title: string;
  payload: unknown;
  created_at: string;
  expires_at: string | null;
}

export async function createSharedResource(args: {
  token: string;
  userId: string;
  kind: string;
  title: string;
  payload: unknown;
  expiresAtUnix: number | null;
}): Promise<void> {
  const expiresAt = args.expiresAtUnix ? new Date(args.expiresAtUnix * 1000) : null;
  await db()`
    insert into shared_resources (token, user_id, kind, title, payload, expires_at)
    values (${args.token}, ${args.userId}, ${args.kind}, ${args.title},
            ${JSON.stringify(args.payload)}, ${expiresAt})
  `;
}

export async function getSharedResource(token: string): Promise<SharedResourceRow | null> {
  const rows = await db()`
    select token, kind, title, payload, created_at, expires_at
    from shared_resources
    where token = ${token} and (expires_at is null or expires_at > now())
  `;
  return (rows[0] as SharedResourceRow) ?? null;
}

export async function listSharedResources(userId: string): Promise<SharedResourceRow[]> {
  const rows = await db()`
    select token, kind, title, payload, created_at, expires_at
    from shared_resources where user_id = ${userId}
    order by created_at desc
  `;
  return rows as SharedResourceRow[];
}

export async function deleteSharedResource(userId: string, token: string): Promise<void> {
  await db()`delete from shared_resources where token = ${token} and user_id = ${userId}`;
  await db()`delete from shared_resources where expires_at is not null and expires_at < now()`;
}

// ---------------------------------------------------------------------------
// F4 Cost events
// ---------------------------------------------------------------------------

export async function insertCostEvent(row: {
  user_id: string | null;
  install_id: string | null;
  submission_id: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}): Promise<void> {
  await db()`
    insert into cost_events (user_id, install_id, submission_id, provider, model,
                             input_tokens, output_tokens, cost_usd)
    values (${row.user_id}, ${row.install_id}, ${row.submission_id}, ${row.provider},
            ${row.model}, ${row.input_tokens}, ${row.output_tokens}, ${row.cost_usd})
    on conflict (install_id, submission_id) do nothing
  `;
}

export interface CostByDay { day: string; cost_usd: number; calls: number; }
export interface CostByModel { model: string; provider: string; cost_usd: number; calls: number; }

export async function costSummary(userId: string, sinceDays: number): Promise<{
  total_usd: number;
  total_calls: number;
  by_day: CostByDay[];
  by_model: CostByModel[];
}> {
  const totals = await db()`
    select coalesce(sum(cost_usd),0) as total_usd, count(*) as total_calls
    from cost_events
    where user_id = ${userId} and created_at > now() - (${sinceDays} || ' days')::interval
  `;
  const byDay = await db()`
    select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
           coalesce(sum(cost_usd),0) as cost_usd, count(*) as calls
    from cost_events
    where user_id = ${userId} and created_at > now() - (${sinceDays} || ' days')::interval
    group by 1 order by 1
  `;
  const byModel = await db()`
    select coalesce(model,'unknown') as model, coalesce(provider,'unknown') as provider,
           coalesce(sum(cost_usd),0) as cost_usd, count(*) as calls
    from cost_events
    where user_id = ${userId} and created_at > now() - (${sinceDays} || ' days')::interval
    group by 1,2 order by 3 desc limit 20
  `;
  const t = totals[0] as { total_usd: number; total_calls: number };
  return {
    total_usd: Number(t.total_usd),
    total_calls: Number(t.total_calls),
    by_day: byDay as CostByDay[],
    by_model: byModel as CostByModel[],
  };
}

// ---------------------------------------------------------------------------
// F6 Audit events
// ---------------------------------------------------------------------------

export async function insertAuditEvent(row: {
  user_id: string | null;
  install_id: string | null;
  action: string;
  target: string;
  metadata: unknown;
}): Promise<void> {
  await db()`
    insert into audit_events (user_id, install_id, action, target, metadata)
    values (${row.user_id}, ${row.install_id}, ${row.action}, ${row.target},
            ${row.metadata == null ? null : JSON.stringify(row.metadata)})
  `;
}

export interface AuditEventRow {
  id: number;
  action: string;
  target: string;
  metadata: unknown;
  created_at: string;
}

export async function queryAuditEvents(userId: string, opts: {
  action?: string; limit: number; before?: number;
}): Promise<AuditEventRow[]> {
  const limit = Math.min(Math.max(opts.limit, 1), 200);
  const beforeId = opts.before ?? Number.MAX_SAFE_INTEGER;
  const action = opts.action ?? '';
  const rows = await db()`
    select id, action, target, metadata, created_at
    from audit_events
    where user_id = ${userId} and id < ${beforeId}
      and (${action} = '' or action = ${action})
    order by id desc limit ${limit}
  `;
  return rows as AuditEventRow[];
}

// ---------------------------------------------------------------------------
// F9 API keys
// ---------------------------------------------------------------------------

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function createApiKey(args: {
  userId: string; name: string; keyHash: string; keyPrefix: string; scopes: string;
}): Promise<string> {
  const rows = await db()`
    insert into api_keys (user_id, name, key_hash, key_prefix, scopes)
    values (${args.userId}, ${args.name}, ${args.keyHash}, ${args.keyPrefix}, ${args.scopes})
    returning id
  `;
  return String((rows[0] as { id: string }).id);
}

export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const rows = await db()`
    select id, name, key_prefix, scopes, last_used_at, created_at, revoked_at
    from api_keys where user_id = ${userId} order by created_at desc
  `;
  return rows as ApiKeyRow[];
}

export async function revokeApiKey(userId: string, id: string): Promise<void> {
  await db()`update api_keys set revoked_at = now() where id = ${id} and user_id = ${userId}`;
}

// Resolve an API key by its hash (for programmatic-access auth). Returns the user
// + scopes if active; bumps last_used_at.
export async function resolveApiKey(keyHash: string): Promise<{ user_id: string; scopes: string } | null> {
  const rows = await db()`
    select user_id, scopes from api_keys
    where key_hash = ${keyHash} and revoked_at is null
  `;
  if (!rows.length) return null;
  await db()`update api_keys set last_used_at = now() where key_hash = ${keyHash}`;
  return rows[0] as { user_id: string; scopes: string };
}

// ---------------------------------------------------------------------------
// F9/F13 Webhooks + notification channels
// ---------------------------------------------------------------------------

export interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  events: string;
  active: boolean;
}

export async function createWebhook(args: {
  userId: string; url: string; secret: string; events: string;
}): Promise<string> {
  const rows = await db()`
    insert into webhooks (user_id, url, secret, events)
    values (${args.userId}, ${args.url}, ${args.secret}, ${args.events})
    returning id
  `;
  return String((rows[0] as { id: string }).id);
}

export async function listWebhooks(userId: string): Promise<WebhookRow[]> {
  const rows = await db()`
    select id, url, secret, events, active from webhooks
    where user_id = ${userId} order by created_at desc
  `;
  return rows as WebhookRow[];
}

export async function deleteWebhook(userId: string, id: string): Promise<void> {
  await db()`delete from webhooks where id = ${id} and user_id = ${userId}`;
}

// Active webhooks for a user that subscribe to an event (or '*').
export async function webhooksForEvent(userId: string, event: string): Promise<WebhookRow[]> {
  const rows = await db()`
    select id, url, secret, events, active from webhooks
    where user_id = ${userId} and active = true
      and (events = '*' or events like ${'%' + event + '%'})
  `;
  return rows as WebhookRow[];
}

export interface NotificationChannelRow {
  id: string;
  kind: string;
  target: string;
  events: string;
  enabled: boolean;
}

export async function createNotificationChannel(args: {
  userId: string; kind: string; target: string; events: string;
}): Promise<string> {
  const rows = await db()`
    insert into notification_channels (user_id, kind, target, events)
    values (${args.userId}, ${args.kind}, ${args.target}, ${args.events})
    returning id
  `;
  return String((rows[0] as { id: string }).id);
}

export async function listNotificationChannels(userId: string): Promise<NotificationChannelRow[]> {
  const rows = await db()`
    select id, kind, target, events, enabled from notification_channels
    where user_id = ${userId} order by created_at desc
  `;
  return rows as NotificationChannelRow[];
}

export async function deleteNotificationChannel(userId: string, id: string): Promise<void> {
  await db()`delete from notification_channels where id = ${id} and user_id = ${userId}`;
}

// Enabled channels for a user subscribed to an event (or '*'). Mirrors
// webhooksForEvent so the dispatcher can fan an event out to both.
export async function channelsForEvent(userId: string, event: string): Promise<NotificationChannelRow[]> {
  const rows = await db()`
    select id, kind, target, events, enabled from notification_channels
    where user_id = ${userId} and enabled = true
      and (events = '*' or events like ${'%' + event + '%'})
  `;
  return rows as NotificationChannelRow[];
}

// ---------------------------------------------------------------------------
// F11 TOTP 2FA
// ---------------------------------------------------------------------------

export async function getTotp(userId: string): Promise<{ secret: string; confirmed: boolean } | null> {
  const rows = await db()`select secret, confirmed from user_totp where user_id = ${userId}`;
  return (rows[0] as { secret: string; confirmed: boolean }) ?? null;
}

export async function upsertTotpSecret(userId: string, secret: string): Promise<void> {
  await db()`
    insert into user_totp (user_id, secret, confirmed)
    values (${userId}, ${secret}, false)
    on conflict (user_id) do update set secret = excluded.secret, confirmed = false
  `;
}

export async function confirmTotp(userId: string): Promise<void> {
  await db()`update user_totp set confirmed = true where user_id = ${userId}`;
}

export async function disableTotp(userId: string): Promise<void> {
  await db()`delete from user_totp where user_id = ${userId}`;
}

// ---------------------------------------------------------------------------
// F12 Org/branding settings
// ---------------------------------------------------------------------------

export interface OrgSettingsRow {
  display_name: string;
  accent_color: string;
  logo_url: string;
}

export async function getOrgSettings(userId: string): Promise<OrgSettingsRow> {
  const rows = await db()`
    select display_name, accent_color, logo_url from org_settings where user_id = ${userId}
  `;
  return (rows[0] as OrgSettingsRow) ?? { display_name: '', accent_color: '', logo_url: '' };
}

export async function upsertOrgSettings(userId: string, s: OrgSettingsRow): Promise<void> {
  await db()`
    insert into org_settings (user_id, display_name, accent_color, logo_url, updated_at)
    values (${userId}, ${s.display_name}, ${s.accent_color}, ${s.logo_url}, now())
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      accent_color = excluded.accent_color,
      logo_url = excluded.logo_url,
      updated_at = now()
  `;
}
