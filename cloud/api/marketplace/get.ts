import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import { getMarketplaceSkill, getSkillVersions, getSubscription } from '../../lib/db';

// GET /api/marketplace/get?slug=  -> one listing + its version history.
// Requires sign-in; a pro-gated listing is only visible to pro viewers (the
// listing's own owner always sees it).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  const slug = String(req.query.slug ?? '').trim().toLowerCase();
  if (!slug) return json(res, 400, { error: 'Missing slug' });

  const skill = await getMarketplaceSkill(slug);
  if (!skill || (skill.visibility !== 'public' && skill.owner_id !== claims.sub)) {
    return json(res, 404, { error: 'Not found' });
  }
  if (skill.min_plan === 'pro' && skill.owner_id !== claims.sub) {
    const { plan } = await getSubscription(claims.sub);
    if (plan !== 'pro') return json(res, 403, { error: 'This skill requires a Pro plan' });
  }

  const versions = await getSkillVersions(skill.id);
  return json(res, 200, {
    skill: {
      slug: skill.slug, name: skill.name, description: skill.description,
      category: skill.category, latest_version: skill.latest_version,
      downloads: skill.downloads, min_plan: skill.min_plan, updated_at: skill.updated_at,
    },
    versions: versions.map((v) => ({ version: v.version, changelog: v.changelog, created: v.created_at })),
  });
}
