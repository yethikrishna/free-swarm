import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { verifyToken } from '../../lib/auth';
import { getUserById, getSubscription } from '../../lib/db';

// POST /api/auth/signin-activate
// The desktop forwards the bearer it received from the handoff page here so the
// cloud re-validates it (never trusting whatever hit localhost) and returns the
// profile + plan. Request: { token, signin_method, email }. Response:
// { user_id, email, plan, expires, signin_method }. 401 if the token is bad.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const body = (req.body ?? {}) as { token?: string; signin_method?: string; nonce?: string };
  const token = body.token;
  if (!token || token.length < 16) return json(res, 400, { error: 'Invalid token' });

  // Phase 1/3: verify token with aud=desktop (prevent cross-surface replay).
  // If the token carries web-aud, reject it (closes Gap G).
  const claims = await verifyToken(token, 'desktop');
  if (!claims) return json(res, 401, { error: 'Token rejected or invalid audience' });

  const user = await getUserById(claims.sub);
  if (!user) return json(res, 401, { error: 'Unknown user' });

  const sub = await getSubscription(user.id);
  json(res, 200, {
    user_id: user.id,
    email: user.email,
    plan: sub.plan,
    expires: sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null,
    signin_method: user.signin_method ?? body.signin_method ?? null,
  });
}
