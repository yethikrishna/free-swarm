import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../../lib/http';
import { authReady } from '../../../lib/auth';
import { dbReady, createDeviceCode } from '../../../lib/db';
import { randomBytes } from 'crypto';

// POST /api/auth/device/code
// RFC 8628 device authorization request. The desktop calls this to obtain a
// secret device_code (which it polls /device/token with) and a short user_code
// the person types into any already-signed-in browser at verification_uri.
// Body: { aud?, install_id? }. No auth: this only mints a pending request that
// is useless until a signed-in user approves the user_code.
const DEVICE_CODE_TTL_SEC = 15 * 60; // 15 minutes to approve before it expires
const POLL_INTERVAL_SEC = 5;
// Crockford-ish alphabet: no 0/O/1/I/L/U to keep hand-typed codes unambiguous.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function makeUserCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
    if (i === 3) out += '-'; // XXXX-XXXX
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!authReady() || !dbReady()) return json(res, 501, { error: 'Sign-in not configured' });

  const body = (req.body ?? {}) as { aud?: string; install_id?: string };
  const aud: 'desktop' | 'web' | 'cloud' =
    body.aud === 'web' || body.aud === 'cloud' ? body.aud : 'desktop';
  const installId = typeof body.install_id === 'string' ? body.install_id.slice(0, 128) : '';

  const deviceCode = randomBytes(32).toString('base64url');
  const expiresAtUnix = Math.floor(Date.now() / 1000) + DEVICE_CODE_TTL_SEC;

  // user_code is unique; retry on the rare collision before giving up.
  let userCode = '';
  let stored = false;
  for (let attempt = 0; attempt < 5 && !stored; attempt++) {
    userCode = makeUserCode();
    try {
      await createDeviceCode({
        deviceCode,
        userCode,
        aud,
        installId,
        intervalSec: POLL_INTERVAL_SEC,
        expiresAtUnix,
      });
      stored = true;
    } catch (e) {
      // Unique-violation on user_code (or device_code): try a fresh user_code.
      if (attempt === 4) return json(res, 503, { error: 'Could not allocate a code, try again' });
    }
  }

  const origin = process.env.WEB_APP_ORIGIN || 'https://freeswarm.myndlabs.tech';
  const verificationUri = `${origin}/device`;

  return json(res, 200, {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_CODE_TTL_SEC,
    interval: POLL_INTERVAL_SEC,
  });
}
