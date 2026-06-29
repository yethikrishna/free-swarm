// F11: two-factor (TOTP) enrollment. Shows the secret to type into an
// authenticator app, then confirms with a 6-digit code before marking enabled.
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import { totpStatus, totpEnroll, totpVerify, totpDisable } from '@/shared/cloud';
import { PanelTitle, Loading, ErrorNote, useAsync } from './ui';

const SecurityPanel: React.FC<{ token: string }> = ({ token }) => {
  const { data, loading, error, reload } = useAsync(() => totpStatus(token), [token]);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setBusy(true); setMsg(null);
    try { const r = await totpEnroll(token); setSecret(r.secret); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await totpVerify(token, code.trim());
      if (r.ok) { setSecret(null); setCode(''); reload(); }
      else setMsg(r.error || 'That code did not match. Try again.');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not verify.'); }
    finally { setBusy(false); }
  };
  const disable = async () => { setBusy(true); try { await totpDisable(token); reload(); } finally { setBusy(false); } };

  return (
    <Box>
      <PanelTitle hint="Add a second step at sign-in with an authenticator app.">Two-factor authentication</PanelTitle>
      {loading ? <Loading /> : error ? <ErrorNote>{error}</ErrorNote> : (
        <>
          {data?.confirmed ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Chip label="Enabled" color="success" />
              <Button variant="text" color="error" disabled={busy} onClick={disable}>Turn off</Button>
            </Box>
          ) : secret ? (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Add this secret to your authenticator app, then enter the 6-digit code:
              </Typography>
              <Box sx={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 2, p: 1.5, bgcolor: '#f3f4f6', borderRadius: 1, mb: 2, userSelect: 'all', textAlign: 'center' }}>
                {secret}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField size="small" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                <Button variant="contained" disabled={busy || code.length !== 6} onClick={confirm}>Confirm</Button>
              </Box>
              {msg && <Alert severity="warning" sx={{ mt: 2 }}>{msg}</Alert>}
            </Box>
          ) : (
            <Button variant="contained" disabled={busy} onClick={begin}>Set up two-factor</Button>
          )}
        </>
      )}
    </Box>
  );
};

export default SecurityPanel;
