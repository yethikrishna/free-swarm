import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import {
  createSharedResource, listSharedResources, deleteSharedResource, insertAuditEvent,
} from '../../lib/db';
import { dispatchEvent } from '../../lib/dispatch';

// GET    /api/share                 -> my share links
// POST   /api/share {kind,title,payload,ttl_days?} -> create a share, returns token
// DELETE /api/share {token}         -> revoke a share
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    const items = await listSharedResources(claims.sub);
    return json(res, 200, {
      shares: items.map((s) => ({
        token: s.token, kind: s.kind, title: s.title,
        created: s.created_at, expires: s.expires_at,
      })),
    });
  }

  if (req.method === 'POST') {
    const kind = String(req.body?.kind ?? '').trim();
    const title = String(req.body?.title ?? '').slice(0, 200);
    const payload = req.body?.payload;
    const ttlDays = Number(req.body?.ttl_days ?? 0);
    if (!['transcript', 'dashboard'].includes(kind)) {
      return json(res, 400, { error: 'kind must be transcript|dashboard' });
    }
    if (payload == null) return json(res, 400, { error: 'Missing payload' });
    const token = randomBytes(18).toString('base64url');
    const expiresAtUnix = ttlDays > 0 ? Math.floor(Date.now() / 1000) + ttlDays * 86400 : null;
    await createSharedResource({ token, userId: claims.sub, kind, title, payload, expiresAtUnix });
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'share.created', target: token, metadata: { kind, title },
    });
    await dispatchEvent(claims.sub, 'share.created', { title: title || 'New share', target: token, summary: kind });
    return json(res, 200, { token });
  }

  if (req.method === 'DELETE') {
    const token = String(req.body?.token ?? '').trim();
    if (!token) return json(res, 400, { error: 'Missing token' });
    await deleteSharedResource(claims.sub, token);
    return json(res, 200, { ok: true });
  }

  return methodNotAllowed(res, 'GET,POST,DELETE');
}
