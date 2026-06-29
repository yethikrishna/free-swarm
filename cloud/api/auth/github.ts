import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json } from '../../lib/http';
import { mintAccessToken, mintRefreshToken, verifyToken } from '../../lib/auth';
import { upsertUser, storeOAuthNonce, consumeOAuthNonce, storeRefreshToken } from '../../lib/db';
import { createHash, randomUUID } from 'crypto';

// GET /api/auth/github
//   (no code)        -> 302 redirect to GitHub's authorization endpoint
//   (?code=...)      -> exchange code for access token, fetch user email, mint bearer
// Env-gated: returns 501 until GITHUB_CLIENT_ID/SECRET/REDIRECT_URI are set.
// GitHub OAuth Apps don't support PKCE, so we rely on a single-use CSRF nonce
// (stored server-side) for state integrity. Tokens are audience-scoped like Google.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return json(res, 501, { error: 'GitHub OAuth not configured' });
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null;
  if (!code) {
    const localPort = typeof req.query.local_port === 'string' ? req.query.local_port : '8324';
    const redirectTo = req.query.redirect_to === '/app' ? '/app' : '/account';
    const client = req.query.client === 'web' ? 'web' : 'desktop';
    const installId = typeof req.query.install_id === 'string' ? req.query.install_id : '';
    const signinNonce = typeof req.query.signin_nonce === 'string' ? req.query.signin_nonce : '';
    // CSRF nonce in place of the old base64 state blob (code_verifier unused; no PKCE on GitHub).
    const csrfNonce = randomUUID();
    await storeOAuthNonce(csrfNonce, {
      code_verifier: '',
      install_id: installId,
      local_port: /^\d+$/.test(localPort) ? localPort : '8324',
      redirect_to: redirectTo,
      client,
      signin_nonce: signinNonce,
    });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'user:email');
    url.searchParams.set('allow_signup', 'true');
    url.searchParams.set('state', csrfNonce);
    res.redirect(302, url.toString());
    return;
  }

  // Validate the single-use CSRF nonce + recover handoff metadata.
  const stateNonce = typeof req.query.state === 'string' ? req.query.state : '';
  const nonceData = await consumeOAuthNonce(stateNonce);
  if (!nonceData) {
    return json(res, 400, { error: 'Invalid or expired sign-in request. Please try again.' });
  }

  // Exchange the authorization code for an access token.
  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResp.ok) return json(res, 502, { error: 'Token exchange failed' });
  const tokenData = (await tokenResp.json()) as { access_token?: string; error?: string };
  if (tokenData.error || !tokenData.access_token) {
    return json(res, 502, { error: 'No access token' });
  }

  // Fetch the authenticated user's primary email.
  const userResp = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userResp.ok) return json(res, 502, { error: 'Could not fetch user email' });
  const emails = (await userResp.json()) as Array<{ email: string; verified: boolean; primary: boolean }>;
  const primaryEmail = emails.find(e => e.primary)?.email || emails[0]?.email;
  if (!primaryEmail) return json(res, 502, { error: 'No email found' });

  const user = await upsertUser(primaryEmail.toLowerCase(), 'github');

  // Recover handoff metadata from the consumed nonce.
  const isWebClient = nonceData.client === 'web';
  const localPort = /^\d+$/.test(nonceData.local_port) ? nonceData.local_port : '8324';
  const redirectTo = nonceData.redirect_to === '/app' ? '/app' : '/account';
  const signinNonce = nonceData.signin_nonce;
  const clientWeb = isWebClient;
  const aud: 'desktop' | 'web' | 'cloud' = isWebClient ? 'web' : 'desktop';

  // Mint audience-scoped access + refresh tokens (15m + 30d).
  const accessToken = await mintAccessToken({ sub: user.id, email: user.email }, aud);
  const refreshToken = await mintRefreshToken({ sub: user.id, email: user.email }, aud);
  const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
  const refreshExpiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const refreshClaims = await verifyToken(refreshToken);
  if (refreshClaims?.jti) {
    await storeRefreshToken(refreshClaims.jti, user.id, refreshTokenHash, aud, refreshExpiresAt);
  }

  // Render the bearer-handoff page.
  const displayEmail = primaryEmail.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const accessTokenJson = JSON.stringify(accessToken);
  const refreshTokenJson = JSON.stringify(refreshToken);
  const userIdJson = JSON.stringify(user.id);
  const emailJson = JSON.stringify(primaryEmail.toLowerCase());
  const localPortJson = JSON.stringify(localPort);
  const clientWebJson = JSON.stringify(clientWeb);
  const signinNonceJson = JSON.stringify(signinNonce);
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
    const signinNonce = ${signinNonceJson};
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
                signin_method: 'github',
                email,
                nonce: signinNonce,
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
          // No desktop (timeout or fetch failed); fall through to deep-link, then web path.
        }

        // Deep-link fallback so a running app picks up the sign-in even if localhost shifted.
        try {
          const deepLink = new URL('freeswarm://auth');
          deepLink.searchParams.set('signin', 'true');
          deepLink.searchParams.set('signin_method', 'github');
          deepLink.searchParams.set('token', accessToken);
          deepLink.searchParams.set('refresh_token', refreshToken);
          deepLink.searchParams.set('email', email);
          if (signinNonce) deepLink.searchParams.set('nonce', signinNonce);
          window.location.href = deepLink.toString();
          await new Promise((r) => setTimeout(r, 1200));
          return;
        } catch (err) {
          // Deep-link unavailable; fall through to the web path.
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
