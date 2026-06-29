import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../../lib/http';
import { authReady, mintAccessToken, mintRefreshToken, verifyToken } from '../../../lib/auth';
import {
  dbReady,
  getDeviceCodeByDeviceCode,
  touchDeviceCodePoll,
  deleteDeviceCode,
  storeRefreshToken,
  getUserById,
  getSubscription,
} from '../../../lib/db';
import { createHash } from 'crypto';

// POST /api/auth/device/token
// RFC 8628 device access-token request. The desktop polls this with the secret
// device_code. We answer with a status the desktop poller understands:
//   pending     -> keep polling
//   slow_down   -> polled faster than `interval`; back off
//   denied      -> user rejected; stop
//   expired     -> the code aged out or was already redeemed; stop
//   approved    -> { access_token, refresh_token, user_id, email, plan, expires }
// On approval we mint the audience-scoped token pair (same shape as the OAuth
// handoff), persist the refresh token for revocation, and delete the row so the
// device_code is strictly single-use.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!authReady() || !dbReady()) return json(res, 501, { error: 'Sign-in not configured' });

  const deviceCode = typeof req.body?.device_code === 'string' ? req.body.device_code : null;
  if (!deviceCode) return json(res, 400, { error: 'device_code required' });

  const row = await getDeviceCodeByDeviceCode(deviceCode);
  // Unknown code: treat as expired (also covers a redeemed/swept row).
  if (!row) return json(res, 200, { status: 'expired' });

  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    await deleteDeviceCode(deviceCode);
    return json(res, 200, { status: 'expired' });
  }

  if (row.status === 'denied') {
    await deleteDeviceCode(deviceCode);
    return json(res, 200, { status: 'denied' });
  }

  if (row.status === 'pending') {
    // Enforce the minimum poll interval; a too-eager poller gets slow_down.
    if (row.last_polled_at) {
      const since = now - new Date(row.last_polled_at).getTime();
      if (since < row.interval_sec * 1000 - 500) {
        return json(res, 200, { status: 'slow_down', interval: row.interval_sec });
      }
    }
    await touchDeviceCodePoll(deviceCode);
    return json(res, 200, { status: 'pending', interval: row.interval_sec });
  }

  // status === 'approved': mint the token pair for the bound user, then burn the row.
  if (!row.user_id) {
    await deleteDeviceCode(deviceCode);
    return json(res, 200, { status: 'expired' });
  }
  const user = await getUserById(row.user_id);
  if (!user) {
    await deleteDeviceCode(deviceCode);
    return json(res, 200, { status: 'expired' });
  }

  const aud = (row.aud === 'web' || row.aud === 'cloud' ? row.aud : 'desktop') as
    | 'desktop'
    | 'web'
    | 'cloud';
  const accessToken = await mintAccessToken({ sub: user.id, email: user.email }, aud);
  const refreshToken = await mintRefreshToken({ sub: user.id, email: user.email }, aud);
  const refreshHash = createHash('sha256').update(refreshToken).digest('hex');
  const refreshExpiresAt = Math.floor(now / 1000) + 30 * 24 * 60 * 60;
  const refreshClaims = await verifyToken(refreshToken);
  if (refreshClaims?.jti) {
    await storeRefreshToken(refreshClaims.jti, user.id, refreshHash, aud, refreshExpiresAt);
  }

  const sub = await getSubscription(user.id);
  await deleteDeviceCode(deviceCode); // single-use

  return json(res, 200, {
    status: 'approved',
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: 15 * 60,
    user_id: user.id,
    email: user.email,
    signin_method: user.signin_method ?? null,
    plan: sub.plan,
    expires: sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null,
  });
}
