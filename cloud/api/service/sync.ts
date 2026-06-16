import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { insertUsageLog } from '../../lib/db';

// POST /api/service/sync: usage ingest from the (web-mode) desktop client.
// Body shape from backend/apps/service/client.py:
//   { client_state: { install_id, user_id, ... }, d: {...}, t, submission_id }
// Fire-and-forget on the client side, so always answer 200 unless the row is
// malformed; idempotent on (install_id, submission_id).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const body = (req.body ?? {}) as {
    client_state?: { install_id?: string; user_id?: string };
    d?: unknown;
    submission_id?: string;
  };
  const cs = body.client_state ?? {};
  if (!cs.install_id || !body.submission_id) {
    return json(res, 400, { error: 'Missing install_id or submission_id' });
  }

  try {
    await insertUsageLog({
      user_id: cs.user_id ?? null,
      install_id: cs.install_id,
      submission_id: body.submission_id,
      kind: 'state',
      payload: body.d ?? {},
    });
  } catch {
    // Never make the client retry on our storage hiccup; it would just respool.
    return json(res, 200, { ok: true, stored: false });
  }
  json(res, 200, { ok: true, stored: true });
}
