import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from '../../../lib/http';
import { generateCodeVerifier, generateCodeChallenge } from '../../../lib/pkce';
import { storeOAuthNonce } from '../../../lib/db';
import { randomUUID } from 'crypto';

// GET /api/auth/google/start?install_id=...&local_port=...&redirect_to=...&signin_nonce=...
// The desktop opens this in the system browser. We generate a PKCE verifier + a
// single-use CSRF nonce, stash them server-side (with the desktop's signin_nonce
// and local_port so the callback can recover them), then 302 to Google's consent
// screen. Only the CSRF nonce travels in the OAuth `state` param; the verifier
// never leaves the server. Closes Gap E (CSRF/interception); the signin_nonce
// closes Gap A (proves this install initiated the flow).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return json(res, 501, { error: 'Google OAuth not configured' });
  }

  const installId = typeof req.query.install_id === 'string' ? req.query.install_id : '';
  const localPort =
    typeof req.query.local_port === 'string' && /^\d+$/.test(req.query.local_port)
      ? req.query.local_port
      : '8324';
  const redirectTo = req.query.redirect_to === '/app' ? '/app' : '/account';
  const client = req.query.client === 'web' ? 'web' : 'desktop';
  const signinNonce = typeof req.query.signin_nonce === 'string' ? req.query.signin_nonce : '';

  const csrfNonce = randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  await storeOAuthNonce(csrfNonce, {
    code_verifier: codeVerifier,
    install_id: installId,
    local_port: localPort,
    redirect_to: redirectTo,
    client,
    signin_nonce: signinNonce,
  });

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', csrfNonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(302, url.toString());
}
