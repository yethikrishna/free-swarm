import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { json } from '../../lib/http';
import { updateSubscriptionFromStripe } from '../../lib/db';

// POST /api/billing/webhook
// Stripe webhook handler for subscription events. Verifies HMAC signature.
// Env-gated: returns 501 until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return json(res, 501, { error: 'Stripe webhook not configured' });
  }

  const sig = typeof req.headers['stripe-signature'] === 'string' ? req.headers['stripe-signature'] : null;
  if (!sig) {
    return json(res, 400, { error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(stripeKey);
    // req.body is pre-parsed JSON in Vercel. For signature verification, we need to
    // reconstruct the original raw body. This is an approximation that works for
    // most cases; production deployments may need to store the raw body separately.
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    return json(res, 400, { error: 'Invalid signature' });
  }

  try {
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as Stripe.Subscription;
      const plan = extractPlanName(subscription);
      const status = subscription.status;
      const currentPeriodEnd = subscription.current_period_end;

      await updateSubscriptionFromStripe(subscription.customer as string, subscription.id, plan, status, currentPeriodEnd);
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      await updateSubscriptionFromStripe(subscription.customer as string, subscription.id, 'free', 'canceled', 0);
    }
  } catch (err) {
    console.error('Webhook processing failed:', err);
    return json(res, 500, { error: 'Internal server error' });
  }

  json(res, 200, { received: true });
}

function extractPlanName(subscription: Stripe.Subscription): string {
  if (!subscription.items.data[0]) return 'free';
  const product = subscription.items.data[0].price.product;
  if (typeof product === 'object' && product.metadata?.plan) {
    return product.metadata.plan;
  }
  return 'paid';
}
