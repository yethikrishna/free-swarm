import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../lib/http';
import { extractBearer, verifyToken } from '../lib/auth';
import { getUserById, getSubscription } from '../lib/db';

// GET /api/me: the desktop and web both call this with the bearer to read the
// signed-in user + live plan. 401 here tells the desktop the token is dead and
// it should revert to own-key routing.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const token = extractBearer(req);
  if (!token) return json(res, 401, { error: 'Missing bearer' });

  const claims = await verifyToken(token);
  if (!claims) return json(res, 401, { error: 'Invalid token' });

  const user = await getUserById(claims.sub);
  if (!user) return json(res, 401, { error: 'Unknown user' });

  const sub = await getSubscription(user.id);
  json(res, 200, {
    user_id: user.id,
    email: user.email,
    signin_method: user.signin_method,
    plan: sub.plan,
    status: sub.status,
    expires: sub.current_period_end
      ? new Date(sub.current_period_end).toISOString()
      : null,
    usage: null,
  });
}
