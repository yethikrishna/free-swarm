import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from '../../lib/http';
import { extractBearer, verifyToken } from '../../lib/auth';
import { revokeAllForUser } from '../../lib/db';

// POST /api/auth/signout
// Verify the bearer, revoke all JTIs for this user (kills all sessions cross-surface),
// and mark all refresh tokens revoked. Fixes Gap D: sign-out now actually revokes.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'POST required' });
  }

  const bearer = extractBearer(req);
  if (!bearer) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const claims = await verifyToken(bearer);
  if (!claims) {
    return json(res, 401, { error: 'Invalid token' });
  }

  // Revoke all JTIs and refresh tokens for this user (cross-surface logout).
  await revokeAllForUser(claims.sub);

  return json(res, 200, { ok: true });
}
