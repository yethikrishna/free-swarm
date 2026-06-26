-- FreeSwarm cloud schema. Apply with: psql "$DATABASE_URL" -f db/schema.sql
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- One row per signed-in person. id is our own opaque id (not the OAuth sub),
-- so a user keeps the same id across sign-in methods that share an email.
create table if not exists users (
  id            text primary key default gen_random_uuid()::text,
  email         text unique not null,
  signin_method text,
  created_at    timestamptz not null default now()
);

-- One subscription row per user (unique). plan='free' for signed-in non-payers.
-- current_period_end is epoch milliseconds to match what the desktop expects
-- from /api/subscription/sync.
create table if not exists subscriptions (
  id                     text primary key default gen_random_uuid()::text,
  user_id                text not null references users(id) on delete cascade,
  plan                   text not null default 'free',
  status                 text not null default 'active',
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     bigint,
  updated_at             timestamptz not null default now(),
  unique (user_id)
);

-- Web-only usage logging. Idempotent on (install_id, submission_id) so a retry
-- from the desktop offline spool is a no-op rather than a double-write.
create table if not exists usage_logs (
  id            bigserial primary key,
  user_id       text,
  install_id    text,
  submission_id text,
  kind          text,
  payload       jsonb,
  created_at    timestamptz not null default now(),
  unique (install_id, submission_id)
);

-- Cloud-synced fusion presets (future feature; table exists so the contract
-- is stable). config_json is the opaque preset the engine knows how to read.
create table if not exists fusion_configs (
  id          text primary key default gen_random_uuid()::text,
  user_id     text not null references users(id) on delete cascade,
  name        text not null,
  config_json jsonb not null,
  created_at  timestamptz not null default now()
);

-- Phase 0: Token revocation. JTIs (unique token IDs) can be blacklisted to invalidate
-- tokens immediately (sign-out, compromised token, etc.). One row per revoked JTI.
create table if not exists revoked_jtis (
  jti        text primary key,
  user_id    text not null references users(id) on delete cascade,
  revoked_at timestamptz not null default now()
);

-- Phase 0: Refresh tokens stored server-side (hashed) so they can be revoked without
-- invalidating all access tokens. Desktop and web may hold multiple refresh tokens.
-- Token version 1: aud='desktop'|'web'|'cloud' to prevent cross-surface reuse.
create table if not exists refresh_tokens (
  jti        text primary key,
  user_id    text not null references users(id) on delete cascade,
  token_hash text not null,
  aud        text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Phase 1 OAuth: temporary CSRF nonce + PKCE verifier + handoff metadata for sign-in
-- (one-time use, 10-min TTL). Consumed once on callback (deleted on read). Prevents
-- CSRF, enables PKCE, and carries the desktop's signin_nonce so the callback can bind
-- the handoff to the install that started it.
create table if not exists oauth_nonces (
  nonce         text primary key,
  code_verifier text not null,
  install_id    text not null default '',
  local_port    text not null default '8324',
  redirect_to   text not null default '/account',
  client        text not null default 'desktop',
  signin_nonce  text not null default '',
  created_at    timestamptz not null default now()
);

-- Device authorization grant (RFC 8628) for FreeSwarm account sign-in on
-- input-constrained or network-isolated surfaces (a desktop that can't receive
-- the localhost OAuth handoff, e.g. WSL/remote/sandboxed). The desktop polls
-- with the secret device_code; the user approves the short user_code from any
-- already-signed-in browser. status: 'pending' until the user approves/denies;
-- 'approved' binds user_id; 'denied' is a hard stop. The row is deleted once the
-- desktop redeems the approved code for tokens (single-use), or by TTL sweep.
create table if not exists device_codes (
  device_code    text primary key,
  user_code      text unique not null,
  user_id        text references users(id) on delete cascade,
  status         text not null default 'pending',
  aud            text not null default 'desktop',
  install_id     text not null default '',
  interval_sec   int not null default 5,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  last_polled_at timestamptz,
  approved_at    timestamptz
);

-- ===========================================================================
-- Feature expansion (F1-F13). All additive + idempotent.
-- ===========================================================================

-- F1 Device/session management. A "session" is an active (un-revoked, unexpired)
-- refresh token. We tag each with a human label + last-seen so the account UI can
-- list "this MacBook, last active 2h ago" and let the user sign a device out.
alter table refresh_tokens add column if not exists device_label text not null default '';
alter table refresh_tokens add column if not exists last_seen_at timestamptz not null default now();

-- F2/F8 Teams + membership (role: owner|admin|member). A team groups users for
-- shared billing + RBAC. Invites are rows with a null user_id until accepted.
create table if not exists teams (
  id         text primary key default gen_random_uuid()::text,
  name       text not null,
  owner_id   text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists team_members (
  id           text primary key default gen_random_uuid()::text,
  team_id      text not null references teams(id) on delete cascade,
  user_id      text references users(id) on delete cascade,
  invite_email text not null,
  role         text not null default 'member',
  status       text not null default 'active', -- 'active' | 'invited'
  created_at   timestamptz not null default now(),
  unique (team_id, invite_email)
);

-- F3 Share links. An opaque token maps to a JSON snapshot (a transcript, a
-- dashboard export). Optional expiry; deleted on revoke or TTL sweep.
create table if not exists shared_resources (
  token      text primary key,
  user_id    text not null references users(id) on delete cascade,
  kind       text not null, -- 'transcript' | 'dashboard'
  title      text not null default '',
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- F4 Cost events. One row per billed model call (web mode + desktop spool). Used
-- for the cost dashboard + budget alerts. submission_id keeps ingest idempotent.
create table if not exists cost_events (
  id            bigserial primary key,
  user_id       text,
  install_id    text,
  submission_id text,
  provider      text,
  model         text,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd      double precision not null default 0,
  created_at    timestamptz not null default now(),
  unique (install_id, submission_id)
);

-- F6 Audit events. Append-only activity trail (sign-in, tool exec, settings
-- change, key created). actor is a user_id; target is a free-form subject.
create table if not exists audit_events (
  id         bigserial primary key,
  user_id    text,
  install_id text,
  action     text not null,
  target     text not null default '',
  metadata   jsonb,
  created_at timestamptz not null default now()
);

-- F9 API keys. Personal programmatic-access keys. We store only sha256(key);
-- the plaintext (prefix fs_live_...) is shown once at creation.
create table if not exists api_keys (
  id           text primary key default gen_random_uuid()::text,
  user_id      text not null references users(id) on delete cascade,
  name         text not null default '',
  key_hash     text unique not null,
  key_prefix   text not null default '', -- first 12 chars, for display
  scopes       text not null default 'read',
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

-- F9/F13 Webhooks. User-registered endpoints that receive signed event POSTs.
create table if not exists webhooks (
  id          text primary key default gen_random_uuid()::text,
  user_id     text not null references users(id) on delete cascade,
  url         text not null,
  secret      text not null,        -- HMAC-SHA256 signing secret
  events      text not null default '*', -- comma list or '*'
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- F11 TOTP 2FA. One row per user once enrolled. secret is base32; confirmed flips
-- true after the first valid code so a half-finished enroll never locks anyone out.
create table if not exists user_totp (
  user_id     text primary key references users(id) on delete cascade,
  secret      text not null,
  confirmed   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- F12 Org/branding settings. One row per owner user (keyed by user_id for now;
-- a team_id column can supersede later). Themes the web account portal.
create table if not exists org_settings (
  user_id      text primary key references users(id) on delete cascade,
  display_name text not null default '',
  accent_color text not null default '',
  logo_url     text not null default '',
  updated_at   timestamptz not null default now()
);

-- F13 Notification channels. Where to push event notifications (Slack incoming
-- webhook, email). enabled per channel; verified after a successful test send.
create table if not exists notification_channels (
  id         text primary key default gen_random_uuid()::text,
  user_id    text not null references users(id) on delete cascade,
  kind       text not null,        -- 'slack' | 'email'
  target     text not null,        -- webhook url or email address
  events     text not null default '*',
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists usage_logs_user_idx on usage_logs (user_id, created_at desc);
create index if not exists fusion_configs_user_idx on fusion_configs (user_id);
create index if not exists revoked_jtis_user_idx on revoked_jtis (user_id, revoked_at desc);
create index if not exists refresh_tokens_user_idx on refresh_tokens (user_id, revoked_at);
create index if not exists device_codes_user_code_idx on device_codes (user_code);
create index if not exists device_codes_expires_idx on device_codes (expires_at);
create index if not exists team_members_team_idx on team_members (team_id);
create index if not exists team_members_user_idx on team_members (user_id);
create index if not exists shared_resources_user_idx on shared_resources (user_id, created_at desc);
create index if not exists cost_events_user_idx on cost_events (user_id, created_at desc);
create index if not exists audit_events_user_idx on audit_events (user_id, created_at desc);
create index if not exists api_keys_user_idx on api_keys (user_id, revoked_at);
create index if not exists webhooks_user_idx on webhooks (user_id, active);
create index if not exists notification_channels_user_idx on notification_channels (user_id, enabled);
