// F2 + F8: teams with role-based membership. Owner/admin can invite; only the
// owner grants admin or changes roles. The server enforces this too; the UI just
// hides controls the caller can't use.
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { listTeams, createTeam, listTeamMembers, inviteMember, removeMember, CloudTeam } from '@/shared/cloud';
import { PanelTitle, Row, Empty, Loading, ErrorNote, useAsync } from './ui';

const Members: React.FC<{ token: string; team: CloudTeam }> = ({ token, team }) => {
  const { data, loading, error, reload } = useAsync(() => listTeamMembers(token, team.id), [token, team.id]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const canManage = data?.my_role === 'owner' || data?.my_role === 'admin';

  const invite = async () => {
    setBusy(true);
    try { await inviteMember(token, team.id, email.trim().toLowerCase(), role); setEmail(''); reload(); }
    catch { /* validation surfaced by disabled state */ } finally { setBusy(false); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  return (
    <Box sx={{ pl: 1, borderLeft: '2px solid #eef2ff', ml: 1, mb: 2 }}>
      {data?.members.map((m) => (
        <Row key={m.id}>
          <Box>
            <Typography variant="body2">{m.invite_email}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{m.status === 'invited' ? 'invited' : 'active'}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip label={m.role} size="small" />
            {canManage && m.role !== 'owner' && (
              <Button size="small" color="error" onClick={() => removeMember(token, team.id, m.id).then(reload)}>Remove</Button>
            )}
          </Box>
        </Row>
      ))}
      {canManage && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <TextField size="small" placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} sx={{ flex: 1 }} />
          <Select size="small" value={role} onChange={(e) => setRole(e.target.value)}>
            <MenuItem value="member">Member</MenuItem>
            {data?.my_role === 'owner' && <MenuItem value="admin">Admin</MenuItem>}
          </Select>
          <Button variant="outlined" disabled={busy || !email.includes('@')} onClick={invite}>Invite</Button>
        </Box>
      )}
    </Box>
  );
};

const TeamsPanel: React.FC<{ token: string }> = ({ token }) => {
  const { data, loading, error, reload } = useAsync(() => listTeams(token), [token]);
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try { await createTeam(token, name.trim()); setName(''); reload(); } finally { setBusy(false); }
  };

  return (
    <Box>
      <PanelTitle hint="Group teammates for shared access and billing.">Teams</PanelTitle>
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField size="small" fullWidth placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="contained" disabled={busy || !name.trim()} onClick={create}>Create</Button>
      </Box>
      {loading ? <Loading /> : error ? <ErrorNote>{error}</ErrorNote> : !data?.teams.length ? (
        <Empty>You're not in any teams yet.</Empty>
      ) : data.teams.map((t) => (
        <Box key={t.id}>
          <Row>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t.role}</Typography>
            </Box>
            <Button size="small" onClick={() => setOpen(open === t.id ? null : t.id)}>
              {open === t.id ? 'Hide' : 'Manage'}
            </Button>
          </Row>
          {open === t.id && <Members token={token} team={t} />}
        </Box>
      ))}
    </Box>
  );
};

export default TeamsPanel;
