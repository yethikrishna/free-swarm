// Web build's account card. There is no local backend on the hosted /app, so
// identity comes from the cloud bearer (cloud.ts) rather than the settings slice.
// OAuth lands back on /app?token=...; index.tsx stores that token before mount.
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { FREESWARM_DEFAULT_PROXY_URL } from '@/shared/config';
import { CloudMe, fetchMe, getCloudToken, clearCloudToken } from '@/shared/cloud';
import ConnectedServices, { GitHubIcon } from './ConnectedServices';

const WebAccountCard: React.FC = () => {
  const c = useClaudeTokens();
  const [token, setToken] = useState(getCloudToken());
  const [me, setMe] = useState<CloudMe | null>(null);
  const [loading, setLoading] = useState<boolean>(!!token);

  // Resolve the cloud bearer to a profile; a dead token (401) signs us back out.
  useEffect(() => {
    if (!token) { setMe(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchMe(token)
      .then((profile) => {
        if (cancelled) return;
        if (!profile) { clearCloudToken(); setToken(''); setMe(null); }
        else setMe(profile);
      })
      .catch(() => { if (!cancelled) setMe(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const cloudBase = FREESWARM_DEFAULT_PROXY_URL.replace(/\/$/, '');

  // Full-page navigation (no Electron bridge on web); OAuth returns to /app?token=.
  // client=web tells the handoff page to skip the desktop localhost POST race.
  const onConnectGitHub = () => {
    window.location.href = `${cloudBase}/api/auth/github?redirect_to=/app&client=web`;
  };

  const onSignOut = () => {
    clearCloudToken();
    setToken('');
    setMe(null);
  };

  const methodLabel = (() => {
    switch (me?.signin_method) {
      case 'google': return 'Signed in with Google';
      case 'github': return 'Signed in with GitHub';
      case 'email': return 'Signed in with email';
      case 'stripe': return 'Signed in via Stripe checkout';
      default: return null;
    }
  })();

  const githubConnected = me?.signin_method === 'github';

  if (loading) {
    return (
      <Box sx={{ p: 2, mb: 2, borderRadius: `${c.radius.lg}px`, border: `1px solid ${c.border.subtle}`, bgcolor: c.bg.surface, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={18} sx={{ color: c.text.muted }} />
      </Box>
    );
  }

  if (!me) {
    return (
      <>
        <Box sx={{ p: 2, mb: 2, borderRadius: `${c.radius.lg}px`, border: `1px solid ${c.border.subtle}`, bgcolor: c.bg.surface }}>
          <Typography sx={{ fontSize: '0.85rem', color: c.text.primary, mb: 0.5 }}>Not signed in</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: c.text.muted, mb: 1.25 }}>
            Sign in to sync settings across devices and back up your data.
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<GitHubIcon />}
            onClick={onConnectGitHub}
            sx={{
              textTransform: 'none',
              fontSize: '0.8rem',
              borderColor: c.border.medium,
              color: c.text.primary,
              '&:hover': { borderColor: c.accent.primary, color: c.accent.primary, bgcolor: 'transparent' },
            }}
          >
            Continue with GitHub
          </Button>
          <Typography sx={{ fontSize: '0.72rem', color: c.text.muted, mt: 1 }}>
            Email and Google sign-in coming soon.
          </Typography>
        </Box>

        <ConnectedServices githubConnected={false} onConnectGitHub={onConnectGitHub} c={c} />
      </>
    );
  }

  return (
    <>
      <Box sx={{ p: 2, mb: 2, borderRadius: `${c.radius.lg}px`, border: `1px solid ${c.border.subtle}`, bgcolor: c.bg.surface }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 600, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {me.email || 'Signed in'}
            </Typography>
            {methodLabel && (
              <Typography sx={{ fontSize: '0.72rem', color: c.text.muted, mt: 0.25 }}>{methodLabel}</Typography>
            )}
          </Box>
          <Button
            variant="text"
            size="small"
            onClick={onSignOut}
            sx={{
              textTransform: 'none',
              fontSize: '0.75rem',
              flexShrink: 0,
              color: c.text.muted,
              '&:hover': { color: c.status.error, bgcolor: 'transparent' },
            }}
          >
            Sign out
          </Button>
        </Box>
      </Box>

      <ConnectedServices githubConnected={githubConnected} onConnectGitHub={onConnectGitHub} c={c} />
    </>
  );
};

export default WebAccountCard;
