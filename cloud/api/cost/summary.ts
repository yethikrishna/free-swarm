import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { costSummary } from '../../lib/db';

// GET /api/cost/summary?days=30 -> totals + per-day + per-model breakdown for the
// cost dashboard. days clamped to [1, 365].
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 365);
  const summary = await costSummary(claims.sub, days);
  json(res, 200, { days, ...summary });
}
