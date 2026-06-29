import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { getOrgSettings, upsertOrgSettings, insertAuditEvent } from '../../lib/db';

// Custom branding for the account portal (F12).
//   GET /api/org/settings -> {display_name, accent_color, logo_url}
//   PUT /api/org/settings  -> update the same fields
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    const s = await getOrgSettings(claims.sub);
    return json(res, 200, s);
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const accent = String(req.body?.accent_color ?? '').trim();
    // Only accept a hex color or empty; reject arbitrary CSS to avoid injection
    // when the web app interpolates this into a style.
    if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
      return json(res, 400, { error: 'accent_color must be #RRGGBB' });
    }
    const logo = String(req.body?.logo_url ?? '').trim();
    if (logo && !/^https:\/\//.test(logo)) {
      return json(res, 400, { error: 'logo_url must be https://' });
    }
    await upsertOrgSettings(claims.sub, {
      display_name: String(req.body?.display_name ?? '').slice(0, 80),
      accent_color: accent,
      logo_url: logo,
    });
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'branding.updated', target: '', metadata: null,
    });
    return json(res, 200, { ok: true });
  }

  return methodNotAllowed(res, 'GET,PUT');
}
