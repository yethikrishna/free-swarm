// F1: where you're signed in. Lists active device sessions and lets the user
// sign any of them out (revokes that refresh token + blacklists its jti).
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { listSessions, revokeSession, CloudSession } from '@/shared/cloud';
import { PanelTitle, Row, Empty, Loading, ErrorNote, useAsync, timeAgo } from './ui';

const SessionsPanel: React.FC<{ token: string }> = ({ token }) => {
  const { data, loading, error, reload } = useAsync(() => listSessions(token), [token]);
  const [busy, setBusy] = useState<string | null>(null);

  const signOut = async (s: CloudSession) => {
    setBusy(s.jti);
    try { await revokeSession(token, s.jti); reload(); } finally { setBusy(null); }
  };

  return (
    <Box>
      <PanelTitle hint="Devices currently signed in to your account.">Active sessions</PanelTitle>
      {loading ? <Loading /> : error ? <ErrorNote>{error}</ErrorNote> : !data?.sessions.length ? (
        <Empty>No other active sessions.</Empty>
      ) : (
        data.sessions.map((s) => (
          <Row key={s.jti}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {s.label}{s.current && <Chip label="This device" size="small" sx={{ ml: 1, height: 20 }} />}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Last active {timeAgo(s.last_seen)}
              </Typography>
            </Box>
            {!s.current && (
              <Button size="small" variant="text" color="error" disabled={busy === s.jti} onClick={() => signOut(s)}>
                Sign out
              </Button>
            )}
          </Row>
        ))
      )}
    </Box>
  );
};

export default SessionsPanel;
