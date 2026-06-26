// F12: custom branding. A display name, accent color, and logo URL the portal
// can theme itself with. Server validates the color/URL shapes.
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import { getOrgSettings, putOrgSettings, OrgSettings } from '@/shared/cloud';
import { PanelTitle, Loading, ErrorNote, useAsync } from './ui';

const BrandingPanel: React.FC<{ token: string }> = ({ token }) => {
  const { data, loading, error } = useAsync(() => getOrgSettings(token), [token]);
  const [form, setForm] = useState<OrgSettings>({ display_name: '', accent_color: '', logo_url: '' });
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = async () => {
    setBusy(true); setMsg(null); setSaved(false);
    try { await putOrgSettings(token, form); setSaved(true); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  };

  const set = (k: keyof OrgSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Box>
      <PanelTitle hint="Personalize how your account portal looks.">Branding</PanelTitle>
      {loading ? <Loading /> : error ? <ErrorNote>{error}</ErrorNote> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField size="small" label="Display name" value={form.display_name} onChange={set('display_name')} />
          <TextField size="small" label="Accent color (#RRGGBB)" value={form.accent_color} onChange={set('accent_color')} placeholder="#6366f1" />
          <TextField size="small" label="Logo URL (https://)" value={form.logo_url} onChange={set('logo_url')} />
          {form.accent_color && /^#[0-9a-fA-F]{6}$/.test(form.accent_color) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: form.accent_color, border: '1px solid #e5e7eb' }} />
              <span style={{ fontSize: 13, color: '#6b7280' }}>Preview</span>
            </Box>
          )}
          {msg && <Alert severity="warning">{msg}</Alert>}
          {saved && <Alert severity="success">Saved.</Alert>}
          <Button variant="contained" disabled={busy} onClick={save} sx={{ alignSelf: 'flex-start' }}>Save branding</Button>
        </Box>
      )}
    </Box>
  );
};

export default BrandingPanel;
