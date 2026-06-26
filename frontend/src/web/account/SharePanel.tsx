// F3 (web side): manage share links you've created. Creation happens from the
// desktop app (export a transcript/dashboard); here you copy or revoke them.
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { listShares, deleteShare } from '@/shared/cloud';
import { PanelTitle, Row, Empty, Loading, ErrorNote, useAsync, timeAgo } from './ui';

const SharePanel: React.FC<{ token: string }> = ({ token }) => {
  const { data, loading, error, reload } = useAsync(() => listShares(token), [token]);
  const [copied, setCopied] = useState<string | null>(null);

  const linkFor = (shareToken: string) => `${window.location.origin}/share?token=${shareToken}`;
  const copy = (shareToken: string) => {
    navigator.clipboard?.writeText(linkFor(shareToken)).then(() => {
      setCopied(shareToken);
      window.setTimeout(() => setCopied(null), 1500);
    }).catch(() => undefined);
  };

  return (
    <Box>
      <PanelTitle hint="Public links to transcripts and dashboards you've shared.">Share links</PanelTitle>
      {loading ? <Loading /> : error ? <ErrorNote>{error}</ErrorNote> : !data?.shares.length ? (
        <Empty>No share links yet. Export a transcript from the desktop app to create one.</Empty>
      ) : data.shares.map((s) => (
        <Row key={s.token}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.title || s.kind}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              <Chip label={s.kind} size="small" sx={{ height: 18, mr: 1 }} />
              {timeAgo(s.created)}{s.expires ? ` · expires ${new Date(s.expires).toLocaleDateString()}` : ''}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button size="small" onClick={() => copy(s.token)}>{copied === s.token ? 'Copied' : 'Copy link'}</Button>
            <Button size="small" color="error" onClick={() => deleteShare(token, s.token).then(reload)}>Revoke</Button>
          </Box>
        </Row>
      ))}
    </Box>
  );
};

export default SharePanel;
