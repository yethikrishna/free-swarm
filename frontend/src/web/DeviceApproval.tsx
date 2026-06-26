// Web-side approval screen for the device authorization grant (RFC 8628). A
// signed-in user lands here from <origin>/device?code=XXXX-XXXX (or types the
// code) and approves the desktop that is polling for tokens. Self-contained MUI
// styling to match WebApp's light account portal.
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { deviceInfo, deviceApprove } from '@/shared/cloud';

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3, bgcolor: '#f9fafb' }}>
    <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 420, border: '1px solid #e5e7eb', borderRadius: 3 }}>
      {children}
    </Paper>
  </Box>
);

type Phase = 'checking' | 'ready' | 'submitting' | 'approved' | 'denied' | 'invalid';

const DeviceApproval: React.FC<{ token: string; email: string; initialCode: string; onDone: () => void }> = ({
  token,
  email,
  initialCode,
  onDone,
}) => {
  const [code, setCode] = useState(initialCode);
  const [phase, setPhase] = useState<Phase>(initialCode ? 'checking' : 'ready');
  const [error, setError] = useState<string | null>(null);

  // If a code arrived in the URL, confirm it's still actionable before showing approve.
  useEffect(() => {
    let cancelled = false;
    if (!initialCode) return;
    (async () => {
      const status = await deviceInfo(initialCode);
      if (cancelled) return;
      if (status === 'pending') setPhase('ready');
      else if (status === 'approved') setPhase('approved');
      else if (status === 'denied') setPhase('denied');
      else {
        setPhase('invalid');
        setError('That code is no longer valid. Start sign-in again on your device.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialCode]);

  const act = async (action: 'approve' | 'deny') => {
    if (!code.trim()) {
      setError('Enter the code shown on your device.');
      return;
    }
    setPhase('submitting');
    setError(null);
    const res = await deviceApprove(token, code.trim(), action);
    if (!res.ok) {
      setPhase('ready');
      setError(res.error || 'Could not approve this code.');
      return;
    }
    setPhase(action === 'deny' ? 'denied' : 'approved');
  };

  if (phase === 'checking') {
    return (
      <Centered>
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      </Centered>
    );
  }

  if (phase === 'approved') {
    return (
      <Centered>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Device connected</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          Your desktop app is now signed in. You can close this tab and return to it.
        </Typography>
        <Button variant="outlined" fullWidth onClick={onDone}>Done</Button>
      </Centered>
    );
  }

  if (phase === 'invalid') {
    // Reachable from a stale localStorage code; give a clear way back to the
    // account view rather than trapping the user on a dead approval form.
    return (
      <Centered>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Code not found</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          {error || 'That code is no longer valid. Start sign-in again on your device.'}
        </Typography>
        <Button variant="outlined" fullWidth onClick={onDone}>Continue to your account</Button>
      </Centered>
    );
  }

  if (phase === 'denied') {
    return (
      <Centered>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Request declined</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          No access was granted. If this was a mistake, start sign-in again on your device.
        </Typography>
        <Button variant="outlined" fullWidth onClick={onDone}>Done</Button>
      </Centered>
    );
  }

  const busy = phase === 'submitting';
  return (
    <Centered>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Connect your device</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        A FreeSwarm desktop app is asking to sign in as <b>{email}</b>. Confirm the code shown on
        that device matches the one below before you approve.
      </Typography>

      <TextField
        fullWidth
        label="Code from your device"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        disabled={busy}
        inputProps={{ style: { letterSpacing: 2, fontFamily: 'monospace' } }}
        sx={{ mb: 2 }}
        autoFocus={!initialCode}
      />

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          fullWidth
          onClick={() => act('approve')}
          disabled={busy || !code.trim()}
          sx={{ py: 1.2 }}
        >
          {busy ? <CircularProgress size={22} /> : 'Approve'}
        </Button>
        <Button
          variant="text"
          onClick={() => act('deny')}
          disabled={busy}
          sx={{ color: 'text.secondary' }}
        >
          Deny
        </Button>
      </Box>
    </Centered>
  );
};

export default DeviceApproval;
