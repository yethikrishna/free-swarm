import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../../lib/http';
import { dbReady, getDeviceCodeByUserCode } from '../../../lib/db';

// GET /api/auth/device/info?user_code=XXXX-XXXX
// Lets the approval page confirm a code exists and is still actionable before the
// user commits. Returns only a coarse status (never user_id/email/device_code), so
// it is safe without auth: knowing a code is "pending" reveals nothing usable
// without also being signed in to approve it.
function normalizeUserCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === 8) return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  return cleaned;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  if (!dbReady()) return json(res, 501, { error: 'Sign-in not configured' });

  const raw = typeof req.query.user_code === 'string' ? req.query.user_code : '';
  const userCode = normalizeUserCode(raw);
  if (!userCode || userCode.length < 8) return json(res, 200, { status: 'not_found' });

  const row = await getDeviceCodeByUserCode(userCode);
  if (!row) return json(res, 200, { status: 'not_found' });
  if (new Date(row.expires_at).getTime() <= Date.now()) return json(res, 200, { status: 'expired' });
  return json(res, 200, { status: row.status });
}
