import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { mintToken } from '../../lib/auth';
import { upsertUser } from '../../lib/db';

// POST /api/auth/dev-login { email } -> { token }
// Mints a real bearer for an email without OAuth, so the full sign-in contract
// (signin-activate, /api/me) is testable end-to-end before Google/Stripe creds
// exist. Gated on ALLOW_DEV_LOGIN=1; returns 404 otherwise so it is inert in
// production.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (process.env.ALLOW_DEV_LOGIN !== '1') return json(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const body = (req.body ?? {}) as { email?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json(res, 400, { error: 'Valid email required' });

  const user = await upsertUser(email, 'email');
  const token = await mintToken({ sub: user.id, email: user.email });
  json(res, 200, { token, user_id: user.id, email: user.email });
}
