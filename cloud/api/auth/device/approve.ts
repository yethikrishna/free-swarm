import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../../lib/http';
import { authReady, extractBearer, verifyToken } from '../../../lib/auth';
import {
  dbReady,
  getDeviceCodeByUserCode,
  approveDeviceCode,
  denyDeviceCode,
} from '../../../lib/db';

// POST /api/auth/device/approve
// Called from the /device approval page by an already-signed-in user. The bearer
// identifies who is approving; binding that user to the pending user_code is what
// lets the polling desktop receive tokens for THIS account. Any valid token of
// the user's works (web or desktop) since approving a device is a self-authorized
// action, not a cross-surface token replay.
// Body: { user_code, action?: 'approve' | 'deny' }.
function normalizeUserCode(raw: string): string {
  // Accept lower-case, spaces, or a missing hyphen; canonicalize to XXXX-XXXX.
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === 8) return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  return cleaned;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!authReady() || !dbReady()) return json(res, 501, { error: 'Sign-in not configured' });

  const bearer = extractBearer(req);
  if (!bearer) return json(res, 401, { error: 'Sign in first' });
  const claims = await verifyToken(bearer);
  if (!claims) return json(res, 401, { error: 'Invalid session' });

  const body = (req.body ?? {}) as { user_code?: string; action?: string };
  const rawCode = typeof body.user_code === 'string' ? body.user_code : '';
  const userCode = normalizeUserCode(rawCode);
  if (!userCode || userCode.length < 8) return json(res, 400, { error: 'Enter the code shown on your device' });

  const row = await getDeviceCodeByUserCode(userCode);
  if (!row) return json(res, 404, { error: 'That code is not valid. Check it and try again.' });
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return json(res, 410, { error: 'That code has expired. Start sign-in again on your device.' });
  }
  if (row.status !== 'pending') {
    // Already approved/denied: report idempotently so a double-submit is harmless.
    return json(res, 200, { ok: true, status: row.status });
  }

  const action = body.action === 'deny' ? 'deny' : 'approve';
  if (action === 'deny') {
    await denyDeviceCode(userCode);
    return json(res, 200, { ok: true, status: 'denied' });
  }

  const ok = await approveDeviceCode(userCode, claims.sub);
  if (!ok) return json(res, 409, { error: 'That code was just used. Start again on your device.' });
  return json(res, 200, { ok: true, status: 'approved', email: claims.email });
}
