// F13: notification channels. Add a Slack incoming webhook or an email address to
// receive event notifications (agent done, budget exceeded, scheduled run).
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { listChannels, createChannel, deleteChannel } from '@/shared/cloud';
import { PanelTitle, Row, Empty, Loading, ErrorNote, useAsync } from './ui';

const NotificationsPanel: React.FC<{ token: string }> = ({ token }) => {
  const { data, loading, error, reload } = useAsync(() => listChannels(token), [token]);
  const [kind, setKind] = useState('slack');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = kind === 'slack'
    ? /^https:\/\/hooks\.slack\.com\//.test(target)
    : target.includes('@');

  const add = async () => {
    setBusy(true);
    try { await createChannel(token, kind, target.trim()); setTarget(''); reload(); }
    catch { /* validation surfaced by disabled state */ } finally { setBusy(false); }
  };

  return (
    <Box>
      <PanelTitle hint="Get pinged when something important happens.">Notifications</PanelTitle>
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Select size="small" value={kind} onChange={(e) => { setKind(e.target.value); setTarget(''); }}>
          <MenuItem value="slack">Slack</MenuItem>
          <MenuItem value="email">Email</MenuItem>
        </Select>
        <TextField size="small" fullWidth value={target} onChange={(e) => setTarget(e.target.value)}
          placeholder={kind === 'slack' ? 'https://hooks.slack.com/services/...' : 'you@email.com'} />
        <Button variant="outlined" disabled={busy || !valid} onClick={add}>Add</Button>
      </Box>
      {loading ? <Loading /> : error ? <ErrorNote>{error}</ErrorNote> : !data?.channels.length ? (
        <Empty>No notification channels yet.</Empty>
      ) : data.channels.map((c) => (
        <Row key={c.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.kind === 'slack' ? 'Slack' : c.target}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{c.events === '*' ? 'all events' : c.events}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip label={c.enabled ? 'on' : 'off'} size="small" color={c.enabled ? 'success' : 'default'} />
            <Button size="small" color="error" onClick={() => deleteChannel(token, c.id).then(reload)}>Remove</Button>
          </Box>
        </Row>
      ))}
    </Box>
  );
};

export default NotificationsPanel;
