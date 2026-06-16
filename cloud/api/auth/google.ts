import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json } from '../../lib/http';
import { mintToken } from '../../lib/auth';
import { upsertUser } from '../../lib/db';

// GET /api/auth/google
//   (no code)        -> 302 redirect to Google's consent screen
//   (?code=...)      -> exchange code, upsert user, mint bearer, hand off
// Env-gated: returns 501 until GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI are set,
// so the service deploys green before OAuth credentials exist.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return json(res, 501, { error: 'Google OAuth not configured' });
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null;
  if (!code) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    res.redirect(302, url.toString());
    return;
  }

  // Exchange the authorization code for an id_token, then read the verified email.
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResp.ok) return json(res, 502, { error: 'Token exchange failed' });
  const tokenData = (await tokenResp.json()) as { id_token?: string };
  if (!tokenData.id_token) return json(res, 502, { error: 'No id_token' });

  // id_token is a JWT; the payload's email is signed by Google.
  const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString());
  const email = String(payload.email ?? '').toLowerCase();
  if (!email) return json(res, 502, { error: 'No email in token' });

  const user = await upsertUser(email, 'google');
  const bearer = await mintToken({ sub: user.id, email: user.email });

  // TODO: render the bearer-handoff page that POSTs the token to the desktop's
  // localhost /api/auth/signin-activate, and sets the fs_session cookie for web.
  // For now return the bearer so the flow is verifiable.
  json(res, 200, { token: bearer, user_id: user.id, email: user.email });
}
