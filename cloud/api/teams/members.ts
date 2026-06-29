import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight, json, methodNotAllowed } from '../../lib/http';
import { requireUser } from '../../lib/auth';
import {
  getTeamRole, listTeamMembers, inviteTeamMember, setMemberRole, removeTeamMember,
  insertAuditEvent,
} from '../../lib/db';

// Team membership management (F2 + F8 RBAC).
//   GET  /api/teams/members?team_id=          -> list members (any member)
//   POST /api/teams/members {team_id, action} -> invite|role|remove (owner/admin only)
// RBAC: only owner/admin may mutate; only owner may grant the admin role.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const claims = await requireUser(req);
  if (!claims) return json(res, 401, { error: 'Unauthorized' });

  const teamId = String((req.method === 'GET' ? req.query.team_id : req.body?.team_id) ?? '').trim();
  if (!teamId) return json(res, 400, { error: 'Missing team_id' });

  const role = await getTeamRole(teamId, claims.sub, claims.email);
  if (!role) return json(res, 403, { error: 'Not a member of this team' });

  if (req.method === 'GET') {
    const members = await listTeamMembers(teamId);
    return json(res, 200, { members, my_role: role });
  }

  if (req.method !== 'POST') return methodNotAllowed(res, 'GET,POST');

  // Mutations require owner or admin.
  if (role !== 'owner' && role !== 'admin') {
    return json(res, 403, { error: 'Requires owner or admin' });
  }

  const action = String(req.body?.action ?? '').trim();

  if (action === 'invite') {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const newRole = String(req.body?.role ?? 'member').trim();
    if (!email || !email.includes('@')) return json(res, 400, { error: 'Valid email required' });
    // Only the owner can mint another admin; admins can only add members.
    if (newRole === 'admin' && role !== 'owner') {
      return json(res, 403, { error: 'Only the owner can add admins' });
    }
    if (newRole === 'owner') return json(res, 400, { error: 'Cannot invite as owner' });
    await inviteTeamMember(teamId, email, newRole === 'admin' ? 'admin' : 'member');
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'team.member_invited', target: teamId, metadata: { email, role: newRole },
    });
    return json(res, 200, { ok: true });
  }

  if (action === 'role') {
    if (role !== 'owner') return json(res, 403, { error: 'Only the owner can change roles' });
    const memberId = String(req.body?.member_id ?? '').trim();
    const newRole = String(req.body?.role ?? '').trim();
    if (!memberId || !['admin', 'member'].includes(newRole)) {
      return json(res, 400, { error: 'member_id and role (admin|member) required' });
    }
    await setMemberRole(teamId, memberId, newRole);
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'team.role_changed', target: memberId, metadata: { role: newRole },
    });
    return json(res, 200, { ok: true });
  }

  if (action === 'remove') {
    const memberId = String(req.body?.member_id ?? '').trim();
    if (!memberId) return json(res, 400, { error: 'Missing member_id' });
    await removeTeamMember(teamId, memberId);
    await insertAuditEvent({
      user_id: claims.sub, install_id: null,
      action: 'team.member_removed', target: memberId, metadata: null,
    });
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: 'Unknown action' });
}
