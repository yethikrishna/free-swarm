import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { insertCostEvent } from '../../lib/db';

// POST /api/cost/ingest: record a billed model call for the cost dashboard.
// Bearer-authed; idempotent on (install_id, submission_id) so the desktop's
// offline spool can retry safely. Body: {submission_id, install_id?, provider,
// model, input_tokens, output_tokens, cost_usd}.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  const b = req.body ?? {};
  await insertCostEvent({
    user_id: claims.sub,
    install_id: b.install_id ? String(b.install_id) : null,
    submission_id: b.submission_id ? String(b.submission_id) : null,
    provider: b.provider ? String(b.provider) : null,
    model: b.model ? String(b.model) : null,
    input_tokens: Number(b.input_tokens ?? 0) || 0,
    output_tokens: Number(b.output_tokens ?? 0) || 0,
    cost_usd: Number(b.cost_usd ?? 0) || 0,
  });
  json(res, 200, { ok: true });
}
