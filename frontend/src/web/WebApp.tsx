// The hosted web build's account portal. The agent engine is desktop-only for
// now, so the web /app is an account surface: sign in, see your plan, download
// the desktop app. Self-contained (own MUI theme, no Redux, no local backend);
// it talks straight to freeswarm-cloud via shared/cloud.ts.
import React, { useEffect, useState } from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import {
  CloudMe,
  devLogin,
  fetchMe,
  getCloudToken,
  setCloudToken,
  clearCloudToken,
} from '@/shared/cloud';
import { FREESWARM_DEFAULT_PROXY_URL } from '@/shared/config';
import DeviceApproval from './DeviceApproval';
import AccountPortal from './account/AccountPortal';

const theme = createTheme({ palette: { mode: 'light' } });

// Survives the OAuth bounce: a device user_code captured at /device is stashed
// here so it's still around after a GitHub/Google sign-in returns to /account.
const PENDING_CODE_KEY = 'fs_pending_device_code';

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3, bgcolor: '#f9fafb' }}>
    <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 420, border: '1px solid #e5e7eb', borderRadius: 3 }}>
      {children}
    </Paper>
  </Box>
);

const GitHubIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 8 }}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const LoginView: React.FC<{ onSignedIn: (token: string) => void }> = ({ onSignedIn }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);

  const signInWithGitHub = () => {
    window.location.href = `${FREESWARM_DEFAULT_PROXY_URL}/api/auth/github?redirect_to=/account&client=web`;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await devLogin(email.trim().toLowerCase());
      setCloudToken(token);
      onSignedIn(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Sign in to FreeSwarm</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        Access your account and plan.
      </Typography>

      <Button
        variant="contained"
        fullWidth
        onClick={signInWithGitHub}
        sx={{ bgcolor: '#24292e', '&:hover': { bgcolor: '#3d444d' }, py: 1.2, mb: 2, textTransform: 'none', fontSize: 15 }}
      >
        <GitHubIcon />
        Continue with GitHub
      </Button>

      <Divider sx={{ mb: 2 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>or</Typography>
      </Divider>

      {!showEmail ? (
        <Button variant="text" fullWidth onClick={() => setShowEmail(true)} sx={{ color: 'text.secondary', textTransform: 'none' }}>
          Sign in with email
        </Button>
      ) : (
        <form onSubmit={submit}>
          <TextField
            fullWidth type="email" label="Email" value={email} required autoFocus
            onChange={(e) => setEmail(e.target.value)} disabled={busy} sx={{ mb: 2 }}
          />
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Button type="submit" variant="outlined" fullWidth disabled={busy || !email} sx={{ py: 1.2 }}>
            {busy ? <CircularProgress size={22} /> : 'Continue with email'}
          </Button>
        </form>
      )}
    </Centered>
  );
};

const WebApp: React.FC = () => {
  // Consume ?token= (OAuth redirect) and ?code= (device approval link) on mount,
  // persist the device code so it outlives the OAuth bounce, then clean the URL.
  const initial = React.useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlCode = params.get('code');
    const onDevicePath = window.location.pathname.replace(/\/+$/, '').endsWith('/device');
    if (urlToken) setCloudToken(urlToken);
    let code = '';
    try {
      if (urlCode && onDevicePath) localStorage.setItem(PENDING_CODE_KEY, urlCode);
      code = onDevicePath && urlCode ? urlCode : localStorage.getItem(PENDING_CODE_KEY) || '';
    } catch {
      code = urlCode || '';
    }
    if (urlToken || urlCode) window.history.replaceState({}, '', window.location.pathname);
    return { token: urlToken || getCloudToken(), code };
  }, []);

  const [token, setToken] = useState<string>(initial.token);
  const [pendingCode, setPendingCode] = useState<string>(initial.code);
  const [me, setMe] = useState<CloudMe | null>(null);
  const [loading, setLoading] = useState<boolean>(!!initial.token);
  const [error, setError] = useState<string | null>(null);

  const load = React.useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const profile = await fetchMe(t);
      if (!profile) {
        clearCloudToken();
        setToken('');
        setMe(null);
      } else {
        setMe(profile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  let content: React.ReactNode;
  if (!token) {
    content = <LoginView onSignedIn={setToken} />;
  } else if (loading) {
    content = <Centered><Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box></Centered>;
  } else if (error) {
    content = (
      <Centered>
        <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="contained" fullWidth onClick={() => load(token)}>Try again</Button>
      </Centered>
    );
  } else if (me && pendingCode) {
    // Signed in with a device code waiting: approve the device, not the account view.
    content = (
      <DeviceApproval
        token={token}
        email={me.email}
        initialCode={pendingCode}
        onDone={() => {
          try { localStorage.removeItem(PENDING_CODE_KEY); } catch { /* ignore */ }
          setPendingCode('');
          window.history.replaceState({}, '', '/');
        }}
      />
    );
  } else if (me) {
    content = <AccountPortal me={me} token={token} onRefresh={() => load(token)} onSignOut={() => { clearCloudToken(); setToken(''); setMe(null); }} />;
  } else {
    content = <LoginView onSignedIn={setToken} />;
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {content}
    </ThemeProvider>
  );
};

export default WebApp;
