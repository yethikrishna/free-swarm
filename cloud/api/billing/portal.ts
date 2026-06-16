import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { extractBearer, verifyToken } from '../../lib/auth';
import { getUserById } from '../../lib/db';

// POST /api/billing/portal -> { url }
// Returns a Stripe Customer Portal URL the desktop/web opens in the browser.
// Env-gated: 501 until STRIPE_SECRET_KEY is set.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const token = extractBearer(req);
  if (!token) return json(res, 401, { error: 'Missing bearer' });
  const claims = await verifyToken(token);
  if (!claims) return json(res, 401, { error: 'Invalid token' });
  const user = await getUserById(claims.sub);
  if (!user) return json(res, 401, { error: 'Unknown user' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(res, 501, { error: 'Billing not configured' });
  }

  // TODO: look up the user's stripe_customer_id, then
  // stripe.billingPortal.sessions.create({ customer, return_url }) and return
  // session.url. Left as a structured stub until Stripe keys exist.
  json(res, 501, { error: 'Billing portal not yet implemented' });
}
