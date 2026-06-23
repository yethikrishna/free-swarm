// Optional sign-in dialog opened from Settings; Google OAuth or GitHub OAuth handoff.

import React, { useEffect } from 'react';
import {
  Box,
  Typography,
  Modal,
  Button,
  IconButton,
} from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import CloseIcon from '@mui/icons-material/Close';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import { fetchSettings } from '@/shared/state/settingsSlice';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { API_BASE, FREESWARM_DEFAULT_PROXY_URL } from '@/shared/config';
import { report } from '@/shared/serviceClient';

const GitHubIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

export default function SignInDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const tokens = useClaudeTokens();
  const dispatch = useAppDispatch();
  const proxyUrl = useAppSelector(
    (s) => s.settings.data.freeswarm_proxy_url || FREESWARM_DEFAULT_PROXY_URL,
  );
  const installId = useAppSelector((s) => s.settings.data.installation_id ?? '');

  // OAuth handoff page POSTs the bearer to the local backend out-of-band; poll so the dialog notices.
  useEffect(() => {
    const id = setInterval(() => { dispatch(fetchSettings()); }, 2000);
    return () => clearInterval(id);
  }, [dispatch]);

  const cloudBase = proxyUrl.replace(/\/$/, '');

  // Mint a single-use install nonce before opening the browser. The cloud carries
  // it through OAuth and echoes it back to the local backend's signin-activate,
  // which validates it so a stray POST can't re-identify this install (Gap A).
  const beginNonce = async (): Promise<string> => {
    try {
      const res = await fetch(`${API_BASE}/auth/begin-signin`, { method: 'POST' });
      if (res.ok) return (await res.json()).nonce ?? '';
    } catch {
      /* nonce is best-effort; the backend tolerates its absence during migration */
    }
    return '';
  };

  const openOAuth = async (path: string, eventName: string) => {
    report('signin', eventName);
    const api = (window as any).freeswarm;
    const url = `${cloudBase}${path}`;
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, '_blank');
  };

  const onGoogle = async () => {
    const localPort = (window as any).__FREESWARM_PORT__ || 8324;
    const nonce = await beginNonce();
    const params = new URLSearchParams({ install_id: installId, local_port: String(localPort), redirect_to: '/app' });
    if (nonce) params.set('signin_nonce', nonce);
    void openOAuth(`/api/auth/google/start?${params.toString()}`, 'google_clicked');
  };

  const onGitHub = async () => {
    const localPort = (window as any).__FREESWARM_PORT__ || 8324;
    const nonce = await beginNonce();
    const params = new URLSearchParams({ install_id: installId, local_port: String(localPort), redirect_to: '/app' });
    if (nonce) params.set('signin_nonce', nonce);
    void openOAuth(`/api/auth/github?${params.toString()}`, 'github_clicked');
  };

  return (
    <Modal
      open
      onClose={onClose}
      hideBackdrop={false}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      slotProps={{ backdrop: { sx: { backgroundColor: 'rgba(0,0,0,0.55)' } } }}
    >
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: 440,
          mx: 2,
          backgroundColor: tokens.bg.surface,
          color: tokens.text.primary,
          border: `1px solid ${tokens.border.subtle}`,
          borderRadius: 3,
          p: 4,
          textAlign: 'center',
          outline: 'none',
        }}
      >
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="Close"
          sx={{ position: 'absolute', top: 10, right: 10, color: tokens.text.tertiary }}
        >
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>

        <Typography
          variant="h5"
          sx={{ fontFamily: '"Charter", Georgia, serif', fontWeight: 500, mb: 1 }}
        >
          Sign in to FreeSwarm
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: tokens.text.muted, mb: 3, lineHeight: 1.5 }}
        >
          Sign in lets us sync your settings and back up your data.
        </Typography>

        <Button
          fullWidth
          variant="contained"
          size="large"
          startIcon={<GoogleIcon />}
          onClick={onGoogle}
          sx={{
            py: 1.4,
            mb: 1.5,
            backgroundColor: tokens.text.primary,
            color: tokens.text.inverse,
            textTransform: 'none',
            fontSize: 15,
            fontWeight: 500,
            '&:hover': { backgroundColor: tokens.text.primary, opacity: 0.9 },
          }}
        >
          Continue with Google
        </Button>

        <Button
          fullWidth
          variant="outlined"
          size="large"
          startIcon={<GitHubIcon />}
          onClick={onGitHub}
          sx={{
            py: 1.4,
            borderColor: tokens.border.medium,
            color: tokens.text.primary,
            textTransform: 'none',
            fontSize: 15,
            fontWeight: 500,
            '&:hover': { borderColor: tokens.text.primary },
          }}
        >
          Continue with GitHub
        </Button>

        <Typography sx={{ mt: 2.5, fontSize: 12, color: tokens.text.muted }}>
          Email sign-in coming soon.
        </Typography>
      </Box>
    </Modal>
  );
}
