import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { getMarketplaceSkill, getSubscription, installSkillManifest, insertAuditEvent } from '../../lib/db';

// POST /api/marketplace/install {slug, version?} -> resolve the manifest to
// install locally, bumping the download counter. Re-checks the plan gate
// server-side: discovery hides pro skills from free users, but install is the
// real enforcement point (a free user must not obtain a pro manifest by slug).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  const slug = String(req.body?.slug ?? '').trim().toLowerCase();
  const version = req.body?.version ? String(req.body.version).trim() : null;
  if (!slug) return json(res, 400, { error: 'Missing slug' });

  const skill = await getMarketplaceSkill(slug);
  if (!skill || (skill.visibility !== 'public' && skill.owner_id !== claims.sub)) {
    return json(res, 404, { error: 'Not found' });
  }
  if (skill.min_plan === 'pro' && skill.owner_id !== claims.sub) {
    const { plan } = await getSubscription(claims.sub);
    if (plan !== 'pro') return json(res, 403, { error: 'This skill requires a Pro plan' });
  }

  const installed = await installSkillManifest(slug, version);
  if (!installed) return json(res, 404, { error: 'Version not found' });

  await insertAuditEvent({
    user_id: claims.sub, install_id: null,
    action: 'skill.installed', target: slug, metadata: { version: installed.version },
  });
  return json(res, 200, installed);
}
