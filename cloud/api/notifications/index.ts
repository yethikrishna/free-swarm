import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import {
  createNotificationChannel, listNotificationChannels, deleteNotificationChannel,
  insertAuditEvent,
} from '../../lib/db';

// Notification channels (F13).
//   GET    /api/notifications                 -> my channels
//   POST   /api/notifications {kind,target}   -> add a Slack webhook or email
//   DELETE /api/notifications {id}            -> remove a channel
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    const channels = await listNotificationChannels(claims.sub);
    return json(res, 200, { channels });
  }

  if (req.method === 'POST') {
    const kind = String(req.body?.kind ?? '').trim();
    const target = String(req.body?.target ?? '').trim();
    const events = String(req.body?.events ?? '*').trim() || '*';
    if (!['slack', 'email'].includes(kind)) {
      return json(res, 400, { error: 'kind must be slack|email' });
    }
    if (kind === 'slack' && !/^https:\/\/hooks\.slack\.com\//.test(target)) {
      return json(res, 400, { error: 'Slack target must be a hooks.slack.com URL' });
    }
    if (kind === 'email' && !target.includes('@')) {
      return json(res, 400, { error: 'email target must be an address' });
    }
    const id = await createNotificationChannel({ userId: claims.sub, kind, target, events });
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'notification.channel_added', target: id, metadata: { kind },
    });
    return json(res, 200, { id });
  }

  if (req.method === 'DELETE') {
    const id = String(req.body?.id ?? '').trim();
    if (!id) return json(res, 400, { error: 'Missing id' });
    await deleteNotificationChannel(claims.sub, id);
    return json(res, 200, { ok: true });
  }

  return methodNotAllowed(res, 'GET,POST,DELETE');
}
