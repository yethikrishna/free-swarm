import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes, createHash } from 'crypto';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { createApiKey, listApiKeys, revokeApiKey, insertAuditEvent } from '../../lib/db';

// GET    /api/keys             -> my API keys (prefix only; never the secret)
// POST   /api/keys {name,scopes}-> mint a key, returns the plaintext ONCE
// DELETE /api/keys {id}        -> revoke a key
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    const keys = await listApiKeys(claims.sub);
    return json(res, 200, {
      keys: keys.map((k) => ({
        id: k.id, name: k.name, prefix: k.key_prefix, scopes: k.scopes,
        last_used: k.last_used_at, created: k.created_at, revoked: k.revoked_at,
      })),
    });
  }

  if (req.method === 'POST') {
    const name = String(req.body?.name ?? '').slice(0, 100) || 'API key';
    const scopes = String(req.body?.scopes ?? 'read').trim();
    if (!['read', 'read,write'].includes(scopes)) {
      return json(res, 400, { error: 'scopes must be "read" or "read,write"' });
    }
    // Plaintext is fs_live_<random>; we persist only sha256(plaintext).
    const secret = 'fs_live_' + randomBytes(24).toString('base64url');
    const keyHash = createHash('sha256').update(secret).digest('hex');
    const id = await createApiKey({
      userId: claims.sub, name, keyHash, keyPrefix: secret.slice(0, 12), scopes,
    });
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'apikey.created', target: id, metadata: { name, scopes },
    });
    // The only time the full key is ever returned.
    return json(res, 200, { id, key: secret });
  }

  if (req.method === 'DELETE') {
    const id = String(req.body?.id ?? '').trim();
    if (!id) return json(res, 400, { error: 'Missing id' });
    await revokeApiKey(claims.sub, id);
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'apikey.revoked', target: id, metadata: null,
    });
    return json(res, 200, { ok: true });
  }

  return methodNotAllowed(res, 'GET,POST,DELETE');
}
