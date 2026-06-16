import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { fetchSettings, signOut } from '@/shared/state/settingsSlice';
import { FREESWARM_DEFAULT_PROXY_URL } from '@/shared/config';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import SignInDialog from '@/app/components/overlays/SignInDialog';

const GitHubIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 6, flexShrink: 0 }}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

/** Account card at top of General tab; three states: signed in, paid-but-unlinked, or not signed in. */
const AccountCard: React.FC = () => {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  // Narrow primitive selectors so unrelated settings edits (theme, etc.) don't re-render this card.
  const userEmail = useAppSelector((s) => s.settings.data.user_email ?? null);
  const userId = useAppSelector((s) => s.settings.data.user_id ?? null);
  const signinMethod = useAppSelector((s) => s.settings.data.signin_method ?? null);
  const hasBearer = useAppSelector((s) => Boolean(s.settings.data.freeswarm_bearer_token));
  const installId = useAppSelector((s) => s.settings.data.installation_id ?? '');
  const proxyUrl = useAppSelector((s) => s.settings.data.freeswarm_proxy_url || FREESWARM_DEFAULT_PROXY_URL);
  const [signingOut, setSigningOut] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [polling, setPolling] = useState(false);

  // Poll for settings updates for up to 60s after the user initiates an OAuth flow.
  useEffect(() => {
    if (!polling) return;
    let ticks = 0;
    const id = setInterval(() => {
      dispatch(fetchSettings());
      ticks++;
      if (ticks >= 30) { clearInterval(id); setPolling(false); }
    }, 2000);
    return () => clearInterval(id);
  }, [polling, dispatch]);

  const methodLabel = (() => {
    switch (signinMethod) {
      case 'google': return 'Signed in with Google';
      case 'github': return 'Signed in with GitHub';
      case 'email': return 'Signed in with email';
      case 'stripe': return 'Signed in via Stripe checkout';
      default: return null;
    }
  })();

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await dispatch(signOut()).unwrap();
    } catch (e) {
      console.error('Sign out failed:', e);
    } finally {
      setSigningOut(false);
    }
  };

  const openOAuth = (path: string) => {
    const api = (window as any).freeswarm;
    const url = proxyUrl.replace(/\/$/, '') + path;
    setPolling(true);
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, '_blank');
  };

  const onSignIn = () => {
    const localPort = (window as any).__FREESWARM_PORT__ || 8324;
    const params = new URLSearchParams({
      install_id: installId,
      local_port: String(localPort),
      redirect_to: '/app',
    });
    openOAuth('/api/auth/google/start?' + params.toString());
  };

  const onConnectGitHub = () => {
    const localPort = (window as any).__FREESWARM_PORT__ || 8324;
    const params = new URLSearchParams({
      install_id: installId,
      local_port: String(localPort),
      redirect_to: '/app',
    });
    openOAuth('/api/auth/github?' + params.toString());
  };

  const githubConnected = signinMethod === 'github';

  // Not signed in at all (no bearer, no user_id); optional, sign-in just adds sync + backup.
  if (!userId && !hasBearer) {
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
            onClick={() => setSignInOpen(true)}
            sx={{
              textTransform: 'none',
              fontSize: '0.8rem',
              borderColor: c.border.medium,
              color: c.text.primary,
              '&:hover': { borderColor: c.accent.primary, color: c.accent.primary, bgcolor: 'transparent' },
            }}
          >
            Sign in to FreeSwarm
          </Button>
          {/* Dialog unmounts on its own once sign-in lands and this branch flips to signed-in. */}
          {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
        </Box>

        {/* Show GitHub connect option even when not signed in */}
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
              {userEmail || 'Signed in'}
            </Typography>
            {methodLabel && (
              <Typography sx={{ fontSize: '0.72rem', color: c.text.muted, mt: 0.25 }}>{methodLabel}</Typography>
            )}
            {!userId && hasBearer && (
              <Typography sx={{ fontSize: '0.72rem', color: c.text.muted, mt: 0.25 }}>
                Subscription connected. Sign in to also link this device to your account.
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            {!userId && hasBearer && (
              <Button
                variant="outlined"
                size="small"
                onClick={onSignIn}
                sx={{
                  textTransform: 'none',
                  fontSize: '0.75rem',
                  borderColor: c.border.medium,
                  color: c.text.primary,
                  '&:hover': { borderColor: c.accent.primary, color: c.accent.primary, bgcolor: 'transparent' },
                }}
              >
                Link account
              </Button>
            )}
            <Button
              variant="text"
              size="small"
              onClick={onSignOut}
              disabled={signingOut}
              sx={{
                textTransform: 'none',
                fontSize: '0.75rem',
                color: c.text.muted,
                '&:hover': { color: c.status.error, bgcolor: 'transparent' },
              }}
            >
              {signingOut ? <CircularProgress size={14} sx={{ color: c.text.muted }} /> : 'Sign out'}
            </Button>
          </Box>
        </Box>
      </Box>

      <ConnectedServices githubConnected={githubConnected} onConnectGitHub={onConnectGitHub} c={c} />
    </>
  );
};

const ConnectedServices: React.FC<{
  githubConnected: boolean;
  onConnectGitHub: () => void;
  c: ReturnType<typeof useClaudeTokens>;
}> = ({ githubConnected, onConnectGitHub, c }) => (
  <Box sx={{ p: 2, mb: 2, borderRadius: `${c.radius.lg}px`, border: `1px solid ${c.border.subtle}`, bgcolor: c.bg.surface }}>
    <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: c.text.primary, mb: 1 }}>Connected Services</Typography>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* Google - coming soon */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, borderRadius: `${c.radius.md}px`, bgcolor: c.bg.subtle }}>
        <Typography sx={{ fontSize: '0.75rem', color: c.text.primary }}>Google</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: c.text.muted, fontStyle: 'italic' }}>Coming soon</Typography>
      </Box>

      {/* GitHub - live */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, borderRadius: `${c.radius.md}px`, bgcolor: c.bg.subtle }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <GitHubIcon />
          <Typography sx={{ fontSize: '0.75rem', color: c.text.primary }}>GitHub</Typography>
        </Box>
        {githubConnected ? (
          <Typography sx={{ fontSize: '0.7rem', color: c.status.success ?? c.accent.primary, fontWeight: 600 }}>Connected</Typography>
        ) : (
          <Button
            size="small"
            variant="outlined"
            onClick={onConnectGitHub}
            sx={{
              textTransform: 'none',
              fontSize: '0.7rem',
              py: 0.25,
              px: 1,
              minWidth: 0,
              borderColor: c.border.medium,
              color: c.text.primary,
              '&:hover': { borderColor: c.accent.primary, color: c.accent.primary, bgcolor: 'transparent' },
            }}
          >
            Connect
          </Button>
        )}
      </Box>
    </Box>
  </Box>
);

export default AccountCard;
