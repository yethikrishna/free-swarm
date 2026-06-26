import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { listSessions } from '../../lib/db';

// GET /api/sessions: list the signed-in user's active devices/sessions (one per
// live refresh token). Used by the web account portal's "where you're signed in".
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  const sessions = await listSessions(claims.sub);
  json(res, 200, {
    sessions: sessions.map((s) => ({
      jti: s.jti,
      aud: s.aud,
      label: s.device_label || s.aud,
      last_seen: s.last_seen_at,
      created: s.created_at,
      // The caller can mark the row matching its own token as "this device".
      current: s.jti === claims.jti,
    })),
  });
}
