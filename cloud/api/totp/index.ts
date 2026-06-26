import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { getTotp, upsertTotpSecret, confirmTotp, disableTotp, insertAuditEvent } from '../../lib/db';
import { generateSecret, verifyTotp, otpauthUri } from '../../lib/totp';

// 2FA (TOTP) management (F11).
//   GET  /api/totp                  -> {enrolled, confirmed}
//   POST /api/totp {action:'enroll'} -> new secret + otpauth URI (unconfirmed)
//   POST /api/totp {action:'verify', code} -> confirm enrollment or validate a code
//   POST /api/totp {action:'disable'} -> remove 2FA
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    const row = await getTotp(claims.sub);
    return json(res, 200, { enrolled: !!row, confirmed: !!row?.confirmed });
  }

  if (req.method !== 'POST') return methodNotAllowed(res, 'GET,POST');

  const action = String(req.body?.action ?? '').trim();

  if (action === 'enroll') {
    const secret = generateSecret();
    await upsertTotpSecret(claims.sub, secret);
    return json(res, 200, { secret, otpauth: otpauthUri(secret, claims.email) });
  }

  if (action === 'verify') {
    const code = String(req.body?.code ?? '').trim();
    const row = await getTotp(claims.sub);
    if (!row) return json(res, 400, { error: 'Not enrolled' });
    if (!verifyTotp(row.secret, code, Date.now())) {
      return json(res, 400, { ok: false, error: 'Invalid code' });
    }
    if (!row.confirmed) {
      await confirmTotp(claims.sub);
      await insertAuditEvent({
        user_id: claims.sub, install_id: null,
        action: 'totp.enabled', target: '', metadata: null,
      });
    }
    return json(res, 200, { ok: true, confirmed: true });
  }

  if (action === 'disable') {
    await disableTotp(claims.sub);
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'totp.disabled', target: '', metadata: null,
    });
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: 'Unknown action' });
}
