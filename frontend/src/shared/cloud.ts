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

// ---------------------------------------------------------------------------
// Device authorization grant (RFC 8628) - web approval side
// ---------------------------------------------------------------------------

// Coarse status of a user_code, used by the /device page to show the right
// prompt before the signed-in user commits. Never returns identifying data.
export async function deviceInfo(userCode: string): Promise<string> {
  try {
    const r = await fetch(
      `${FREESWARM_DEFAULT_PROXY_URL}/api/auth/device/info?user_code=${encodeURIComponent(userCode)}`,
    );
    if (!r.ok) return 'not_found';
    const d = (await r.json()) as { status?: string };
    return d.status || 'not_found';
  } catch {
    return 'not_found';
  }
}

// Bind the signed-in user to a pending user_code (or reject it). The bearer is
// what authorizes the waiting device to receive tokens for this account.
export async function deviceApprove(
  token: string,
  userCode: string,
  action: 'approve' | 'deny' = 'approve',
): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const r = await post('/api/auth/device/approve', { user_code: userCode, action }, token);
    const d = (await r.json().catch(() => ({}))) as { status?: string; error?: string };
    if (!r.ok) return { ok: false, error: d.error || 'Could not approve this code.' };
    return { ok: true, status: d.status };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
}

// ---------------------------------------------------------------------------
// Account-management API (F1-F13). All bearer-authed; thin typed wrappers over
// the cloud endpoints so the account portal components stay declarative.
// ---------------------------------------------------------------------------

const BASE = FREESWARM_DEFAULT_PROXY_URL;

async function authGet(path: string, token: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}
async function authSend(method: string, path: string, body: unknown, token: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `${method} ${path} -> ${r.status}`);
  return data;
}

// F1 Sessions
export interface CloudSession {
  jti: string; aud: string; label: string; last_seen: string; created: string; current: boolean;
}
export const listSessions = (t: string): Promise<{ sessions: CloudSession[] }> => authGet('/api/sessions', t);
export const revokeSession = (t: string, jti: string) => authSend('POST', '/api/sessions/revoke', { jti }, t);

// F2/F8 Teams
export interface CloudTeam { id: string; name: string; owner_id: string; role?: string; }
export interface CloudTeamMember { id: string; user_id: string | null; invite_email: string; role: string; status: string; }
export const listTeams = (t: string): Promise<{ teams: CloudTeam[] }> => authGet('/api/teams', t);
export const createTeam = (t: string, name: string) => authSend('POST', '/api/teams', { name }, t);
export const listTeamMembers = (t: string, teamId: string): Promise<{ members: CloudTeamMember[]; my_role: string }> =>
  authGet(`/api/teams/members?team_id=${encodeURIComponent(teamId)}`, t);
export const inviteMember = (t: string, teamId: string, email: string, role: string) =>
  authSend('POST', '/api/teams/members', { team_id: teamId, action: 'invite', email, role }, t);
export const setMemberRole = (t: string, teamId: string, memberId: string, role: string) =>
  authSend('POST', '/api/teams/members', { team_id: teamId, action: 'role', member_id: memberId, role }, t);
export const removeMember = (t: string, teamId: string, memberId: string) =>
  authSend('POST', '/api/teams/members', { team_id: teamId, action: 'remove', member_id: memberId }, t);

// F3 Share links
export interface CloudShare { token: string; kind: string; title: string; created: string; expires: string | null; }
export const listShares = (t: string): Promise<{ shares: CloudShare[] }> => authGet('/api/share', t);
export const createShare = (t: string, kind: string, title: string, payload: unknown, ttlDays?: number) =>
  authSend('POST', '/api/share', { kind, title, payload, ttl_days: ttlDays ?? 0 }, t);
export const deleteShare = (t: string, token: string) => authSend('DELETE', '/api/share', { token }, t);
export const resolveShare = (shareToken: string): Promise<any> =>
  fetch(`${BASE}/api/share/get?token=${encodeURIComponent(shareToken)}`).then((r) => (r.ok ? r.json() : null));

// F4 Cost
export interface CostSummary {
  days: number; total_usd: number; total_calls: number;
  by_day: { day: string; cost_usd: number; calls: number }[];
  by_model: { model: string; provider: string; cost_usd: number; calls: number }[];
}
export const costSummary = (t: string, days = 30): Promise<CostSummary> => authGet(`/api/cost/summary?days=${days}`, t);

// F6 Audit
export interface AuditEvent { id: number; action: string; target: string; metadata: unknown; created_at: string; }
export const queryAudit = (t: string, opts: { action?: string; limit?: number; before?: number } = {}): Promise<{ events: AuditEvent[]; next_before: number | null }> => {
  const p = new URLSearchParams();
  if (opts.action) p.set('action', opts.action);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.before) p.set('before', String(opts.before));
  return authGet(`/api/audit?${p.toString()}`, t);
};

// F9 API keys
export interface CloudApiKey { id: string; name: string; prefix: string; scopes: string; last_used: string | null; created: string; revoked: string | null; }
export const listApiKeys = (t: string): Promise<{ keys: CloudApiKey[] }> => authGet('/api/keys', t);
export const createApiKey = (t: string, name: string, scopes: string): Promise<{ id: string; key: string }> =>
  authSend('POST', '/api/keys', { name, scopes }, t);
export const revokeApiKey = (t: string, id: string) => authSend('DELETE', '/api/keys', { id }, t);

// F9 Webhooks
export interface CloudWebhook { id: string; url: string; events: string; active: boolean; secret: string; }
export const listWebhooks = (t: string): Promise<{ webhooks: CloudWebhook[] }> => authGet('/api/webhooks', t);
export const createWebhook = (t: string, url: string, events: string): Promise<{ id: string; secret: string }> =>
  authSend('POST', '/api/webhooks', { url, events }, t);
export const deleteWebhook = (t: string, id: string) => authSend('DELETE', '/api/webhooks', { id }, t);

// F11 TOTP 2FA
export interface TotpStatus { enrolled: boolean; confirmed: boolean; }
export const totpStatus = (t: string): Promise<TotpStatus> => authGet('/api/totp', t);
export const totpEnroll = (t: string): Promise<{ secret: string; otpauth: string }> =>
  authSend('POST', '/api/totp', { action: 'enroll' }, t);
export const totpVerify = (t: string, code: string): Promise<{ ok: boolean; confirmed?: boolean; error?: string }> =>
  authSend('POST', '/api/totp', { action: 'verify', code }, t);
export const totpDisable = (t: string) => authSend('POST', '/api/totp', { action: 'disable' }, t);

// F12 Org/branding
export interface OrgSettings { display_name: string; accent_color: string; logo_url: string; }
export const getOrgSettings = (t: string): Promise<OrgSettings> => authGet('/api/org/settings', t);
export const putOrgSettings = (t: string, s: OrgSettings) => authSend('PUT', '/api/org/settings', s, t);

// F13 Notifications
export interface NotificationChannel { id: string; kind: string; target: string; events: string; enabled: boolean; }
export const listChannels = (t: string): Promise<{ channels: NotificationChannel[] }> => authGet('/api/notifications', t);
export const createChannel = (t: string, kind: string, target: string) =>
  authSend('POST', '/api/notifications', { kind, target }, t);
export const deleteChannel = (t: string, id: string) => authSend('DELETE', '/api/notifications', { id }, t);
