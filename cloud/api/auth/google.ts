import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json } from '../../lib/http';
import { mintAccessToken, mintRefreshToken, verifyToken } from '../../lib/auth';
import { upsertUser, consumeOAuthNonce, storeRefreshToken } from '../../lib/db';
import { createHash } from 'crypto';

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
    const localPort = typeof req.query.local_port === 'string' ? req.query.local_port : '8324';
    const redirectTo = req.query.redirect_to === '/app' ? '/app' : '/account';
    const client = req.query.client === 'web' ? 'web' : 'desktop';
    const state = Buffer.from(JSON.stringify({ local_port: localPort, redirect_to: redirectTo, client })).toString('base64url');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    res.redirect(302, url.toString());
    return;
  }

  // Phase 1: Validate nonce + PKCE (if present).
  let codeVerifier: string | null = null;
  let installId: string | null = null;
  if (typeof req.query.state === 'string') {
    const nonceData = await consumeOAuthNonce(req.query.state);
    if (!nonceData) {
      return json(res, 400, { error: 'Invalid or expired nonce' });
    }
    codeVerifier = nonceData.code_verifier;
    installId = nonceData.install_id;
  }

  // Exchange the authorization code for an id_token, then read the verified email.
  // PKCE: include code_verifier if available (Phase 1).
  const params = {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  } as Record<string, string>;
  if (codeVerifier) {
    params.code_verifier = codeVerifier;
  }

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!tokenResp.ok) return json(res, 502, { error: 'Token exchange failed' });
  const tokenData = (await tokenResp.json()) as { id_token?: string };
  if (!tokenData.id_token) return json(res, 502, { error: 'No id_token' });

  // id_token is a JWT; the payload's email is signed by Google.
  const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString());
  const email = String(payload.email ?? '').toLowerCase();
  if (!email) return json(res, 502, { error: 'No email in token' });

  const user = await upsertUser(email, 'google');

  // Phase 1: Determine audience based on client type (desktop vs web).
  // Default to 'web' if not set by Phase 0 nonce path.
  let aud: 'desktop' | 'web' | 'cloud' = 'web';
  let localPort = '8324';
  let redirectTo = '/account';
  let clientWeb = false;

  // If we have install_id from nonce, this is a desktop sign-in (aud=desktop).
  if (installId) {
    aud = 'desktop';
  } else {
    // Fall back to old state-based detection (Phase 1 compatibility).
    try {
      const stateRaw = typeof req.query.state === 'string' ? req.query.state : '';
      const state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString());
      if (typeof state.local_port === 'string' && /^\d+$/.test(state.local_port)) localPort = state.local_port;
      if (state.redirect_to === '/app') redirectTo = '/app';
      if (state.client === 'web') {
        clientWeb = true;
        aud = 'web';
      } else {
        aud = 'desktop';
      }
    } catch {}
  }

  // Mint access token + refresh token (15m + 30d, audience-scoped).
  const accessToken = await mintAccessToken({ sub: user.id, email: user.email }, aud);
  const refreshToken = await mintRefreshToken({ sub: user.id, email: user.email }, aud);

  // Store refresh token hash in DB for revocation checks.
  const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
  const refreshExpiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days
  const claims = await verifyToken(refreshToken);
  if (claims?.jti) {
    await storeRefreshToken(claims.jti, user.id, refreshTokenHash, aud, refreshExpiresAt);
  }

  // Render the bearer-handoff page. Pass both access token (15m) + refresh token (30d).
  // Desktop POSTs to /api/auth/signin-activate with nonce; web gets redirected with token in URL.
  const displayEmail = email.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const accessTokenJson = JSON.stringify(accessToken);
  const refreshTokenJson = JSON.stringify(refreshToken);
  const userIdJson = JSON.stringify(user.id);
  const emailJson = JSON.stringify(email);
  const localPortJson = JSON.stringify(localPort);
  const clientWebJson = JSON.stringify(clientWeb);
  const webAppUrl = JSON.stringify((process.env.WEB_APP_ORIGIN || 'https://freeswarm.myndlabs.tech') + redirectTo);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signing you in...</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 20px;
      background: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 32px;
      max-width: 400px;
      text-align: center;
    }
    h1 {
      font-size: 20px;
      margin: 0 0 12px 0;
      color: #1f2937;
    }
    p {
      color: #6b7280;
      margin: 0 0 24px 0;
      font-size: 14px;
    }
    .spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid #e5e7eb;
      border-top-color: #111827;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Signing you in...</h1>
    <p>Welcome back, ${displayEmail}!</p>
  </div>

  <script>
    const accessToken = ${accessTokenJson};
    const refreshToken = ${refreshTokenJson};
    const userId = ${userIdJson};
    const email = ${emailJson};
    const localPort = ${localPortJson};
    const clientWeb = ${clientWebJson};
    const webAppUrl = ${webAppUrl};

    async function handoff() {
      // Web sign-in: skip the desktop localhost handoff entirely. Trying it races
      // a desktop app that happens to be running on the same machine, which would
      // swallow the token and leave the web tab signed-out.
      if (!clientWeb) {
        try {
          const response = await Promise.race([
            fetch('http://localhost:' + localPort + '/api/auth/signin-activate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: accessToken,
                refresh_token: refreshToken,
                signin_method: 'google',
                email,
              }),
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
          ]);
          if (response.ok) {
            // Desktop received the token; close this window.
            if (window.opener) window.close();
            return;
          }
        } catch (err) {
          // No desktop (timeout or fetch failed); fall through to web path.
        }
      }

      // Web path: pass token in URL so the web app's origin can store it in its own localStorage.
      // localStorage is origin-scoped; setting it here (api.*) would not be visible on the web app domain.
      try {
        const url = new URL(webAppUrl);
        url.searchParams.set('token', accessToken);
        url.searchParams.set('refresh_token', refreshToken);
        window.location.href = url.toString();
      } catch (err) {
        document.body.innerHTML = '<div class="container"><h1>Error</h1><p>Could not sign in. Please try again.</p></div>';
      }
    }

    handoff();
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
