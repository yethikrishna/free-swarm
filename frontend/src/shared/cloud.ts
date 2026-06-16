// Client for the freeswarm-cloud service (api.freeswarm.myndlabs.tech). Used by
// the hosted web build, which has no local backend to proxy through, so it
// talks to the cloud directly. The desktop build keeps using the local backend
// (config.ts API_BASE) and never imports this.
import { FREESWARM_DEFAULT_PROXY_URL } from './config';

const TOKEN_KEY = 'fs_web_token';

export function getCloudToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setCloudToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private-mode storage denial: token just won't persist across reloads */
  }
}

export function clearCloudToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export interface CloudMe {
  user_id: string;
  email: string;
  plan: string;
  status: string;
  expires: string | null;
  signin_method: string | null;
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${FREESWARM_DEFAULT_PROXY_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

// Dev sign-in: mints a real bearer for an email without OAuth. Works only while
// the cloud has ALLOW_DEV_LOGIN=1. Google sign-in replaces this for production.
export async function devLogin(email: string): Promise<string> {
  const r = await post('/api/auth/dev-login', { email });
  if (r.status === 404) throw new Error('Dev login is disabled on this server.');
  if (!r.ok) throw new Error('Sign-in failed. Check the email and try again.');
  const data = (await r.json()) as { token?: string };
  if (!data.token) throw new Error('Sign-in failed: no token returned.');
  return data.token;
}

// Resolve the bearer to a profile + plan. null means the token is dead (401)
// and the caller should sign out.
export async function fetchMe(token: string): Promise<CloudMe | null> {
  const r = await fetch(`${FREESWARM_DEFAULT_PROXY_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error('Could not load your account right now.');
  return (await r.json()) as CloudMe;
}

export async function subscriptionSync(token: string): Promise<void> {
  await post('/api/subscription/sync', {}, token);
}
