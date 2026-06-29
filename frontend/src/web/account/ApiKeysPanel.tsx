// F9: personal API keys + webhooks. A freshly minted key is shown once (we only
// store its hash), so we surface a copy-it-now banner that the user must dismiss.
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import {
  listApiKeys, createApiKey, revokeApiKey,
  listWebhooks, createWebhook, deleteWebhook,
} from '@/shared/cloud';
import { PanelTitle, Row, Empty, Loading, ErrorNote, useAsync, timeAgo } from './ui';

const ApiKeysPanel: React.FC<{ token: string }> = ({ token }) => {
  const keys = useAsync(() => listApiKeys(token), [token]);
  const hooks = useAsync(() => listWebhooks(token), [token]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const mint = async () => {
    setBusy(true);
    try {
      const r = await createApiKey(token, name.trim() || 'API key', 'read,write');
      setFresh(r.key); setName(''); keys.reload();
    } finally { setBusy(false); }
  };
  const addHook = async () => {
    setBusy(true);
    try { await createWebhook(token, hookUrl.trim(), '*'); setHookUrl(''); hooks.reload(); }
    catch { /* invalid url surfaced by disabled state */ }
    finally { setBusy(false); }
  };

  return (
    <Box>
      <PanelTitle hint="Keys for programmatic access. Treat them like passwords.">API keys</PanelTitle>

      {fresh && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setFresh(null)}>
          Copy your new key now, it won't be shown again:
          <Box sx={{ fontFamily: 'monospace', mt: 1, wordBreak: 'break-all', userSelect: 'all' }}>{fresh}</Box>
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField size="small" fullWidth placeholder="Key name (e.g. CI server)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="contained" disabled={busy} onClick={mint}>Create</Button>
      </Box>

      {keys.loading ? <Loading /> : keys.error ? <ErrorNote>{keys.error}</ErrorNote> : !keys.data?.keys.length ? (
        <Empty>No API keys yet.</Empty>
      ) : keys.data.keys.map((k) => (
        <Row key={k.id}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {k.name} {k.revoked && <Chip label="revoked" size="small" sx={{ ml: 1, height: 20 }} />}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
              {k.prefix}... · {k.last_used ? `used ${timeAgo(k.last_used)}` : 'never used'}
            </Typography>
          </Box>
          {!k.revoked && (
            <Button size="small" color="error" onClick={() => revokeApiKey(token, k.id).then(keys.reload)}>Revoke</Button>
          )}
        </Row>
      ))}

      <PanelTitle hint="Get a signed POST when events happen on your account.">Webhooks</PanelTitle>
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField size="small" fullWidth placeholder="https://your-endpoint.example/hook" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
        <Button variant="outlined" disabled={busy || !/^https:\/\//.test(hookUrl)} onClick={addHook}>Add</Button>
      </Box>
      {hooks.loading ? <Loading /> : hooks.error ? <ErrorNote>{hooks.error}</ErrorNote> : !hooks.data?.webhooks.length ? (
        <Empty>No webhooks yet.</Empty>
      ) : hooks.data.webhooks.map((h) => (
        <Row key={h.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.url}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>signs with {h.secret.slice(0, 14)}...</Typography>
          </Box>
          <Button size="small" color="error" onClick={() => deleteWebhook(token, h.id).then(hooks.reload)}>Remove</Button>
        </Row>
      ))}
    </Box>
  );
};

export default ApiKeysPanel;
