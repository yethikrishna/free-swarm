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

-- Phase 1 OAuth: temporary nonce + PKCE verifier pairs for sign-in (one-time use, 10-min TTL).
-- Consumed once on callback (deleted on read). Prevents CSRF and enables PKCE.
create table if not exists oauth_nonces (
  nonce         text primary key,
  code_verifier text not null,
  install_id    text not null,
  created_at    timestamptz not null default now()
);

create index if not exists usage_logs_user_idx on usage_logs (user_id, created_at desc);
create index if not exists fusion_configs_user_idx on fusion_configs (user_id);
create index if not exists revoked_jtis_user_idx on revoked_jtis (user_id, revoked_at desc);
create index if not exists refresh_tokens_user_idx on refresh_tokens (user_id, revoked_at);
