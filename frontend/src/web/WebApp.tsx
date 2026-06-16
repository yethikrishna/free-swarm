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
import {
  CloudMe,
  devLogin,
  fetchMe,
  subscriptionSync,
  getCloudToken,
  setCloudToken,
  clearCloudToken,
} from '@/shared/cloud';

const theme = createTheme({ palette: { mode: 'light' } });

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3, bgcolor: '#f9fafb' }}>
    <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 420, border: '1px solid #e5e7eb', borderRadius: 3 }}>
      {children}
    </Paper>
  </Box>
);

const LoginView: React.FC<{ onSignedIn: (token: string) => void }> = ({ onSignedIn }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        Use your email to access your account and plan.
      </Typography>
      <form onSubmit={submit}>
        <TextField
          fullWidth type="email" label="Email" value={email} required
          onChange={(e) => setEmail(e.target.value)} disabled={busy} sx={{ mb: 2 }}
        />
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Button type="submit" variant="contained" fullWidth disabled={busy || !email}
          sx={{ bgcolor: '#111827', '&:hover': { bgcolor: '#374151' }, py: 1.2 }}>
          {busy ? <CircularProgress size={22} sx={{ color: '#fff' }} /> : 'Continue'}
        </Button>
      </form>
    </Centered>
  );
};

const AccountView: React.FC<{ me: CloudMe; onRefresh: () => void; onSignOut: () => void }> = ({ me, onRefresh, onSignOut }) => {
  const [syncing, setSyncing] = useState(false);
  const token = getCloudToken();

  const sync = async () => {
    setSyncing(true);
    try {
      await subscriptionSync(token);
      onRefresh();
    } finally {
      setSyncing(false);
    }
  };

  const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 1, borderBottom: '1px solid #f3f4f6' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
    </Box>
  );

  return (
    <Centered>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>Your account</Typography>
      <Row label="Email" value={me.email} />
      <Row label="Plan" value={me.plan} />
      <Row label="Status" value={me.status} />
      <Row label="Renews" value={me.expires ? new Date(me.expires).toLocaleDateString() : 'No active subscription'} />
      <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
        <Button variant="outlined" onClick={sync} disabled={syncing} sx={{ flex: 1 }}>
          {syncing ? <CircularProgress size={20} /> : 'Sync subscription'}
        </Button>
        <Button variant="text" onClick={onSignOut} sx={{ color: 'text.secondary' }}>Sign out</Button>
      </Box>
    </Centered>
  );
};

const WebApp: React.FC = () => {
  const [token, setToken] = useState<string>(getCloudToken());
  const [me, setMe] = useState<CloudMe | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getCloudToken());
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
  } else if (me) {
    content = <AccountView me={me} onRefresh={() => load(token)} onSignOut={() => { clearCloudToken(); setToken(''); setMe(null); }} />;
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
