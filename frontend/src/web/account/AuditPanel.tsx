// F6: activity log. Read-only, keyset-paginated trail of account actions.
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { queryAudit, AuditEvent } from '@/shared/cloud';
import { PanelTitle, Row, Empty, Loading, ErrorNote, useAsync, timeAgo } from './ui';

// Map machine action names to a short human phrase.
const LABELS: Record<string, string> = {
  'session.revoked': 'Signed a device out',
  'team.created': 'Created a team',
  'team.member_invited': 'Invited a teammate',
  'team.member_removed': 'Removed a teammate',
  'team.role_changed': 'Changed a role',
  'apikey.created': 'Created an API key',
  'apikey.revoked': 'Revoked an API key',
  'webhook.created': 'Added a webhook',
  'share.created': 'Created a share link',
  'totp.enabled': 'Turned on two-factor',
  'totp.disabled': 'Turned off two-factor',
  'branding.updated': 'Updated branding',
  'notification.channel_added': 'Added a notification channel',
};

const AuditPanel: React.FC<{ token: string }> = ({ token }) => {
  const { data, loading, error } = useAsync(() => queryAudit(token, { limit: 50 }), [token]);
  const [more, setMore] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const all = [...(data?.events ?? []), ...more];
  const nextBefore = cursor ?? data?.next_before ?? null;

  const loadMore = async () => {
    if (!nextBefore) return;
    setBusy(true);
    try {
      const r = await queryAudit(token, { limit: 50, before: nextBefore });
      setMore((m) => [...m, ...r.events]);
      setCursor(r.next_before);
    } finally { setBusy(false); }
  };

  return (
    <Box>
      <PanelTitle hint="A record of important actions on your account.">Activity log</PanelTitle>
      {loading ? <Loading /> : error ? <ErrorNote>{error}</ErrorNote> : !all.length ? (
        <Empty>No activity recorded yet.</Empty>
      ) : (
        <>
          {all.map((e) => (
            <Row key={e.id}>
              <Typography variant="body2">{LABELS[e.action] || e.action}{e.target ? <span style={{ color: '#9ca3af' }}> · {e.target.slice(0, 24)}</span> : null}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{timeAgo(e.created_at)}</Typography>
            </Row>
          ))}
          {nextBefore && <Button fullWidth sx={{ mt: 1 }} disabled={busy} onClick={loadMore}>Load more</Button>}
        </>
      )}
    </Box>
  );
};

export default AuditPanel;
