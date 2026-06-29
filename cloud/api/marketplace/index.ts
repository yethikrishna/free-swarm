import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import {
  getSubscription, publishSkillVersion, listMarketplaceSkills, listMySkills,
  deleteMarketplaceSkill, insertAuditEvent,
} from '../../lib/db';
import { dispatchEvent } from '../../lib/dispatch';

// GET    /api/marketplace?q=&category=&mine=1  -> discover (or list my own)
// POST   /api/marketplace {slug,name,version,manifest,...} -> publish a version
// DELETE /api/marketplace {slug}               -> unpublish (owner only)
//
// A listing is a versioned agent template (F10 manifest). Discovery filters by
// the viewer's plan so pro-gated skills stay hidden from free users; install
// (see ./install) re-checks the gate server-side.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET') {
    if (req.query.mine) {
      const mine = await listMySkills(claims.sub);
      return json(res, 200, { skills: mine });
    }
    const { plan } = await getSubscription(claims.sub);
    const rows = await listMarketplaceSkills({
      viewerPlan: plan,
      query: req.query.q ? String(req.query.q) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    // Project to a public shape: never leak owner_id (internal user id) to other
    // viewers. Mirrors marketplace/get.ts.
    const skills = rows.map((s) => ({
      slug: s.slug, name: s.name, description: s.description, category: s.category,
      latest_version: s.latest_version, downloads: s.downloads,
      min_plan: s.min_plan, updated_at: s.updated_at,
    }));
    return json(res, 200, { skills });
  }

  if (req.method === 'POST') {
    const b = req.body ?? {};
    const slug = String(b.slug ?? '').trim().toLowerCase();
    const name = String(b.name ?? '').trim().slice(0, 120);
    const version = String(b.version ?? '').trim();
    const manifest = b.manifest;
    if (!SLUG_RE.test(slug)) {
      return json(res, 400, { error: 'slug must be 3-40 chars, lowercase letters/digits/hyphens' });
    }
    if (!name) return json(res, 400, { error: 'name is required' });
    if (!SEMVER_RE.test(version)) return json(res, 400, { error: 'version must be MAJOR.MINOR.PATCH' });
    if (manifest == null || typeof manifest !== 'object') {
      return json(res, 400, { error: 'manifest object is required' });
    }
    // Cap stored size so a published manifest can't be used to bloat storage.
    if (JSON.stringify(manifest).length > 64_000) {
      return json(res, 400, { error: 'manifest is too large (64KB max)' });
    }
    const minPlan = b.min_plan === 'pro' ? 'pro' : 'free';
    const visibility = b.visibility === 'unlisted' ? 'unlisted' : 'public';
    const result = await publishSkillVersion({
      ownerId: claims.sub,
      slug,
      name,
      description: String(b.description ?? '').slice(0, 2000),
      category: String(b.category ?? 'general').slice(0, 40),
      version,
      changelog: String(b.changelog ?? '').slice(0, 2000),
      manifest,
      visibility,
      minPlan,
    });
    if (!result) return json(res, 409, { error: 'That slug is taken by another publisher' });
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'skill.published', target: slug, metadata: { version, name },
    });
    await dispatchEvent(claims.sub, 'skill.published', {
      title: `${name} ${version}`, target: slug, summary: 'Published to the marketplace',
    });
    return json(res, 200, result);
  }

  if (req.method === 'DELETE') {
    const slug = String(req.body?.slug ?? '').trim().toLowerCase();
    if (!slug) return json(res, 400, { error: 'Missing slug' });
    const ok = await deleteMarketplaceSkill(claims.sub, slug);
    if (!ok) return json(res, 404, { error: 'Not found or not yours' });
    return json(res, 200, { ok: true });
  }

  return methodNotAllowed(res, 'GET,POST,DELETE');
}
