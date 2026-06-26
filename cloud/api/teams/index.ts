import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { listTeamsForUser, createTeam, insertAuditEvent } from '../../lib/db';

// GET  /api/teams       -> teams the user owns or belongs to (+ their role)
// POST /api/teams {name} -> create a team (caller becomes owner)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    const teams = await listTeamsForUser(claims.sub, claims.email);
    return json(res, 200, { teams });
  }

  if (req.method === 'POST') {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return json(res, 400, { error: 'Missing name' });
    const team = await createTeam(claims.sub, name, claims.email);
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'team.created', target: team.id, metadata: { name },
    });
    return json(res, 200, { team });
  }

  return methodNotAllowed(res, 'GET,POST');
}
