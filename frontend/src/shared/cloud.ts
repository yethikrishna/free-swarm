// Client for the freeswarm-cloud service (api.freeswarm.myndlabs.tech). Used by
// the hosted web build, which has no local backend to proxy through, so it
// talks to the cloud directly. The desktop build keeps using the local backend
// (config.ts API_BASE) and never imports this.
import { FREESWARM_DEFAULT_PROXY_URL } from './config';

const TOKEN_KEY = 'fs_web_token';
const REFRESH_KEY = 'fs_web_refresh_token';

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

export function getCloudRefreshToken(): string {
  try {
    return localStorage.getItem(REFRESH_KEY) || '';
  } catch {
    return '';
  }
}

export function setCloudRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearCloudToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

// Exchange the stored refresh token for a fresh 15m access token. Returns the new
// token on success (and persists it), or '' if no/expired refresh token.
export async function refreshCloudToken(): Promise<string> {
  const refresh = getCloudRefreshToken();
  if (!refresh) return '';
  try {
    const r = await post('/api/auth/refresh', { refresh_token: refresh, aud: 'web' });
    if (!r.ok) return '';
    const data = (await r.json()) as { access_token?: string };
    if (data.access_token) {
      setCloudToken(data.access_token);
      return data.access_token;
    }
  } catch {
    /* network failure: caller falls back to sign-out */
  }
  return '';
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
// and the caller should sign out. On a 401 we first try to silently re-mint the
// access token from the refresh token; only a failed refresh signs the user out.
export async function fetchMe(token: string): Promise<CloudMe | null> {
  const r = await fetch(`${FREESWARM_DEFAULT_PROXY_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) {
    const fresh = await refreshCloudToken();
    if (!fresh) return null;
    const r2 = await fetch(`${FREESWARM_DEFAULT_PROXY_URL}/api/me`, {
      headers: { Authorization: `Bearer ${fresh}` },
    });
    if (r2.status === 401) return null;
    if (!r2.ok) throw new Error('Could not load your account right now.');
    return (await r2.json()) as CloudMe;
  }
  if (!r.ok) throw new Error('Could not load your account right now.');
  return (await r.json()) as CloudMe;
}

export async function subscriptionSync(token: string): Promise<void> {
  await post('/api/subscription/sync', {}, token);
}
