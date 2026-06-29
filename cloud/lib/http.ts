// Shared response + CORS helpers. The web app calls this API cross-origin from
// the browser, so every handler must answer preflight and stamp CORS headers.
import type { VercelRequest, VercelResponse } from '@vercel/node';

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const allowed = process.env.WEB_APP_ORIGIN || '*';
  const origin = req.headers.origin;
  // Echo the request origin when it matches the configured app origin so
  // credentialed (cookie) requests are accepted; fall back to the literal.
  res.setHeader('Access-Control-Allow-Origin', origin && origin === allowed ? origin : allowed);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}

// Returns true when the request was a preflight and has been answered, so the
// caller should stop. Always call this first in a handler.
export function handlePreflight(req: VercelRequest, res: VercelResponse): boolean {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function json(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function methodNotAllowed(res: VercelResponse, allow: string): void {
  res.setHeader('Allow', allow);
  res.status(405).json({ error: 'Method not allowed' });
}
