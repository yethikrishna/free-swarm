import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json } from '../lib/http';
import { sql, dbReady } from '../lib/db';
import { authReady } from '../lib/auth';

// GET /api/health: liveness + config/DB connectivity for deploy verification.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  let db: 'ok' | 'down' | 'unconfigured' = 'unconfigured';
  if (dbReady()) {
    try {
      await sql!`select 1`;
      db = 'ok';
    } catch {
      db = 'down';
    }
  }

  const healthy = db === 'ok' && authReady();
  json(res, healthy ? 200 : 503, {
    status: healthy ? 'ok' : 'degraded',
    db,
    auth: authReady() ? 'ok' : 'unconfigured',
  });
}
