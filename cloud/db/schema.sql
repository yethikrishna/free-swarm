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

create index if not exists usage_logs_user_idx on usage_logs (user_id, created_at desc);
create index if not exists fusion_configs_user_idx on fusion_configs (user_id);
create index if not exists revoked_jtis_user_idx on revoked_jtis (user_id, revoked_at desc);
create index if not exists refresh_tokens_user_idx on refresh_tokens (user_id, revoked_at);
create index if not exists device_codes_user_code_idx on device_codes (user_code);
create index if not exists device_codes_expires_idx on device_codes (expires_at);
