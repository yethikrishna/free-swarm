import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { extractBearer, verifyToken } from '../../lib/auth';
import { getUserById, getSubscriptionWithStripe } from '../../lib/db';

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

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return json(res, 501, { error: 'Billing not configured' });
  }

  const subscription = await getSubscriptionWithStripe(claims.sub);
  if (!subscription.stripe_customer_id) {
    return json(res, 400, { error: 'No active subscription' });
  }

  const stripe = new Stripe(stripeKey);
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://freeswarm.myndlabs.tech'}/app`,
  });

  json(res, 200, { url: session.url });
}
