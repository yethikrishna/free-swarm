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
