import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from '../../../lib/http';
import { generateCodeVerifier, generateCodeChallenge } from '../../../lib/pkce';
import { storeOAuthNonce } from '../../../lib/db';
import { randomUUID } from 'crypto';

// POST /api/auth/google/start
// Generate a PKCE verifier + CSRF nonce for a sign-in attempt. The client receives the nonce
// and includes it in the OAuth state param; the nonce lookup on callback proves this install
// initiated the sign-in (closes Gap A) and returns the verifier for PKCE validation (Gap E).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'POST required' });
  }

  const installId = typeof req.body?.install_id === 'string' ? req.body.install_id : null;
  if (!installId) {
    return json(res, 400, { error: 'install_id required' });
  }

  const nonce = randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  await storeOAuthNonce(nonce, codeVerifier, installId);

  return json(res, 200, {
    nonce,
    code_challenge: codeChallenge,
  });
}
