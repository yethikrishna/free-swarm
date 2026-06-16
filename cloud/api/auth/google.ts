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

  // Render the bearer-handoff page. Desktop users will POST to localhost to sign in;
  // web users will close the popup and find themselves already signed in via localStorage.
  const displayEmail = email.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const tokenJson = JSON.stringify(bearer);
  const userIdJson = JSON.stringify(user.id);
  const emailJson = JSON.stringify(email);
  const webAppUrl = JSON.stringify((process.env.WEB_APP_ORIGIN || 'https://freeswarm.myndlabs.tech') + '/app');

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
    const token = ${tokenJson};
    const userId = ${userIdJson};
    const email = ${emailJson};
    const webAppUrl = ${webAppUrl};

    async function handoff() {
      // Try desktop localhost first (Electron app)
      try {
        const response = await Promise.race([
          fetch('http://localhost:8324/api/auth/signin-activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, signin_method: 'google', email }),
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

      // Web path: store token in localStorage and redirect to the web app
      try {
        localStorage.setItem('fs_web_token', token);
        window.location.href = webAppUrl;
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
