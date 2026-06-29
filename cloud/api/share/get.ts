import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { getSharedResource } from '../../lib/db';

// GET /api/share/get?token=  -> resolve a public share link. No auth: the opaque
// 144-bit token IS the capability. Returns 404 once expired/revoked.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const token = String(req.query.token ?? '').trim();
  if (!token) return json(res, 400, { error: 'Missing token' });

  const row = await getSharedResource(token);
  if (!row) return json(res, 404, { error: 'Not found or expired' });

  json(res, 200, { kind: row.kind, title: row.title, payload: row.payload, created: row.created_at });
}
