import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { createWebhook, listWebhooks, deleteWebhook, insertAuditEvent } from '../../lib/db';

// GET    /api/webhooks                 -> my webhooks (secret shown so the user can verify signatures)
// POST   /api/webhooks {url,events?}   -> register a webhook, returns its signing secret
// DELETE /api/webhooks {id}            -> remove a webhook
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    const hooks = await listWebhooks(claims.sub);
    return json(res, 200, {
      webhooks: hooks.map((h) => ({
        id: h.id, url: h.url, events: h.events, active: h.active, secret: h.secret,
      })),
    });
  }

  if (req.method === 'POST') {
    const url = String(req.body?.url ?? '').trim();
    const events = String(req.body?.events ?? '*').trim() || '*';
    if (!/^https:\/\//.test(url)) return json(res, 400, { error: 'url must be https://' });
    const secret = 'whsec_' + randomBytes(24).toString('base64url');
    const id = await createWebhook({ userId: claims.sub, url, secret, events });
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'webhook.created', target: id, metadata: { url, events },
    });
    return json(res, 200, { id, secret });
  }

  if (req.method === 'DELETE') {
    const id = String(req.body?.id ?? '').trim();
    if (!id) return json(res, 400, { error: 'Missing id' });
    await deleteWebhook(claims.sub, id);
    return json(res, 200, { ok: true });
  }

  return methodNotAllowed(res, 'GET,POST,DELETE');
}
