import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { revokeSession, insertAuditEvent } from '../../lib/db';

// POST /api/sessions/revoke {jti}: sign a specific device out by revoking its
// refresh token + blacklisting its jti. Only the owning user can revoke; a
// foreign or already-revoked jti returns 404 so it isn't a probe oracle.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  const jti = String(req.body?.jti ?? '').trim();
  if (!jti) return json(res, 400, { error: 'Missing jti' });

  const ok = await revokeSession(claims.sub, jti);
  if (!ok) return json(res, 404, { error: 'Session not found' });

  await insertAuditEvent({
    user_id: claims.sub, install_id: null,
    action: 'session.revoked', target: jti, metadata: null,
  });
  json(res, 200, { ok: true });
}
