import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { queryAuditEvents, insertAuditEvent } from '../../lib/db';

// GET  /api/audit?action=&limit=&before=  -> paginated audit trail (keyset on id)
// POST /api/audit {action,target,metadata} -> append an event (desktop emits these)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    const action = req.query.action ? String(req.query.action) : undefined;
    const limit = Number(req.query.limit ?? 50) || 50;
    const before = req.query.before ? Number(req.query.before) : undefined;
    const events = await queryAuditEvents(claims.sub, { action, limit, before });
    const nextBefore = events.length ? events[events.length - 1].id : null;
    return json(res, 200, { events, next_before: nextBefore });
  }

  if (req.method === 'POST') {
    const action = String(req.body?.action ?? '').trim();
    if (!action) return json(res, 400, { error: 'Missing action' });
    await insertAuditEvent({
      user_id: claims.sub,
      install_id: req.body?.install_id ? String(req.body.install_id) : null,
      action,
      target: String(req.body?.target ?? '').slice(0, 300),
      metadata: req.body?.metadata ?? null,
    });
    return json(res, 200, { ok: true });
  }

  return methodNotAllowed(res, 'GET,POST');
}
