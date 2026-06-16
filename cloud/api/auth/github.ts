import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json } from '../../lib/http';
import { mintToken } from '../../lib/auth';
import { upsertUser } from '../../lib/db';

// GET /api/auth/github
//   (no code)        -> 302 redirect to GitHub's authorization endpoint
//   (?code=...)      -> exchange code for access token, fetch user email, mint bearer
// Env-gated: returns 501 until GITHUB_CLIENT_ID/SECRET/REDIRECT_URI are set.
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
    const state = Buffer.from(JSON.stringify({ local_port: localPort, redirect_to: redirectTo })).toString('base64url');
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'user:email');
    url.searchParams.set('allow_signup', 'true');
    url.searchParams.set('state', state);
    res.redirect(302, url.toString());
    return;
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
  const bearer = await mintToken({ sub: user.id, email: user.email });

  // Decode state to recover local_port and redirect_to from the initiating page.
  let localPort = '8324';
  let redirectTo = '/account';
  try {
    const stateRaw = typeof req.query.state === 'string' ? req.query.state : '';
    const state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString());
    if (typeof state.local_port === 'string' && /^\d+$/.test(state.local_port)) localPort = state.local_port;
    if (state.redirect_to === '/app') redirectTo = '/app';
  } catch {}

  // Render the bearer-handoff page.
  const displayEmail = primaryEmail.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const tokenJson = JSON.stringify(bearer);
  const userIdJson = JSON.stringify(user.id);
  const emailJson = JSON.stringify(primaryEmail.toLowerCase());
  const localPortJson = JSON.stringify(localPort);
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
    const token = ${tokenJson};
    const userId = ${userIdJson};
    const email = ${emailJson};
    const localPort = ${localPortJson};
    const webAppUrl = ${webAppUrl};

    async function handoff() {
      // Try desktop localhost first (Electron app)
      try {
        const response = await Promise.race([
          fetch('http://localhost:' + localPort + '/api/auth/signin-activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, signin_method: 'github', email }),
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

      // Web path: pass token in URL so the web app's origin can store it in its own localStorage.
      // localStorage is origin-scoped; setting it here (api.*) would not be visible on the web app domain.
      try {
        const url = new URL(webAppUrl);
        url.searchParams.set('token', token);
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
