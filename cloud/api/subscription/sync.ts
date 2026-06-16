import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { extractBearer, verifyToken } from '../../lib/auth';
import { getUserById, getSubscription } from '../../lib/db';

// POST /api/subscription/sync
// Desktop calls this once per launch to reconcile plan state. Response shape the
// desktop reads: { plan, current_period_end (epoch ms), status, synced }.
// 401 -> revoked, 402 -> expired (desktop then clears local credentials).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const token = extractBearer(req);
  if (!token) return json(res, 401, { error: 'Missing bearer' });
  const claims = await verifyToken(token);
  if (!claims) return json(res, 401, { error: 'Invalid token' });

  const user = await getUserById(claims.sub);
  if (!user) return json(res, 401, { error: 'Unknown user' });

  const sub = await getSubscription(user.id);

  // TODO: when STRIPE_SECRET_KEY is set, fetch the live subscription from Stripe
  // and upsert plan/status/current_period_end before responding. Until then we
  // reflect the stored row (synced=false signals no Stripe reconciliation ran).
  json(res, 200, {
    plan: sub.plan,
    status: sub.status,
    current_period_end: sub.current_period_end,
    synced: false,
  });
}
