import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LockIcon from '@mui/icons-material/Lock';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { AppSettings } from '@/shared/state/settingsSlice';
import type { ProviderStatus } from '@/shared/hooks/useProviderStatus';
import { saveKeychainSecret, type KeychainSecretField } from '@/shared/keychain';
import ProviderStatusBadge from './ProviderStatusBadge';
import type { SettingsStyles } from '../settingsStyles';

type ApiKeyField = 'anthropic_api_key' | 'openai_api_key' | 'google_api_key' | 'openrouter_api_key';

export interface ApiKeyConfig {
  field: ApiKeyField;
  label: string;
  desc: string;
  placeholder: string;
  href: string;
  /** 9router provider id this key maps to, for live health lookup. */
  providerId: string;
}

export const API_KEY_CARDS: ApiKeyConfig[] = [
  { field: 'anthropic_api_key', label: 'Anthropic', desc: 'The latest Claude models.', placeholder: 'sk-ant-...', href: 'https://console.anthropic.com/settings/keys', providerId: 'anthropic' },
  { field: 'openai_api_key', label: 'OpenAI', desc: 'The latest OpenAI models.', placeholder: 'sk-...', href: 'https://platform.openai.com/api-keys', providerId: 'openai' },
  { field: 'google_api_key', label: 'Google', desc: 'The latest Gemini models.', placeholder: 'AIza...', href: 'https://aistudio.google.com/apikey', providerId: 'gemini' },
  { field: 'openrouter_api_key', label: 'OpenRouter', desc: 'Hundreds of models from every major provider.', placeholder: 'sk-or-...', href: 'https://openrouter.ai/keys', providerId: 'openrouter' },
];

const GetKeyLink: React.FC<{ href: string }> = ({ href }) => {
  const c = useClaudeTokens();
  return (
    <Typography
      component="a"
      href={href}
      target="_blank"
      rel="noopener"
      sx={{ color: c.accent.primary, fontSize: '0.72rem', whiteSpace: 'nowrap', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 0.3, '&:hover': { textDecoration: 'underline' } }}
    >
      Get key <OpenInNewIcon sx={{ fontSize: 11 }} />
    </Typography>
  );
};

const ApiKeyCard: React.FC<{
  config: ApiKeyConfig;
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  styles: SettingsStyles;
  status?: ProviderStatus;
  routerOffline?: boolean;
  // Keychain mode: when true, the key is managed in the OS keychain (not the form/disk).
  useKeychain?: boolean;
  stored?: boolean;
  onKeychainChange?: () => void;
}> = ({ config, form, setForm, showApiKey, setShowApiKey, styles, status, routerOffline, useKeychain, stored, onKeychainChange }) => {
  const c = useClaudeTokens();
  const { fieldSx, descSx, labelSx } = styles;

  // Keychain-managed local state: `editing` holds the typed value while replacing
  // a key (null = not editing). The shared form is never touched in this mode, so
  // the settings PUT never carries a plaintext key.
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const header = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={labelSx}>{config.label}</Typography>
        <ProviderStatusBadge status={status} routerOffline={routerOffline} />
      </Box>
      <Typography sx={{ ...descSx, mb: 1 }}>{config.desc}</Typography>
    </>
  );

  if (useKeychain) {
    const commit = async (val: string | null) => {
      setBusy(true);
      try {
        await saveKeychainSecret(config.field as KeychainSecretField, val);
        onKeychainChange?.();
      } finally {
        setBusy(false);
        setEditing(null);
      }
    };

    // Stored + not editing: show the secured state with replace/remove actions.
    if (stored && editing === null) {
      return (
        <Box>
          {header}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flex: 1, color: c.text.secondary, fontSize: '0.78rem' }}>
              <LockIcon sx={{ fontSize: 14, color: c.status?.success ?? c.accent.primary }} />
              <Typography sx={{ fontSize: '0.78rem', color: c.text.secondary }}>Stored securely in your keychain</Typography>
            </Box>
            <Button size="small" disabled={busy} onClick={() => setEditing('')} sx={{ textTransform: 'none', fontSize: '0.72rem', color: c.text.secondary, minWidth: 0 }}>Replace</Button>
            <Button size="small" disabled={busy} onClick={() => commit(null)} sx={{ textTransform: 'none', fontSize: '0.72rem', color: c.status?.error ?? c.text.secondary, minWidth: 0 }}>Remove</Button>
          </Box>
        </Box>
      );
    }

    // Not stored (or replacing): show a text field that writes straight to the keychain on blur.
    return (
      <Box>
        {header}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            type={showApiKey ? 'text' : 'password'}
            value={editing ?? ''}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={() => { if (editing) commit(editing); else setEditing(null); }}
            disabled={busy}
            size="small"
            fullWidth
            placeholder={config.placeholder}
            autoFocus={editing === '' && stored}
            sx={{ ...fieldSx, '& .MuiOutlinedInput-root': { ...fieldSx['& .MuiOutlinedInput-root'], fontFamily: c.font.mono } }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowApiKey(!showApiKey)} edge="end" size="small" sx={{ color: c.text.tertiary }}>
                    {showApiKey ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <GetKeyLink href={config.href} />
        </Box>
      </Box>
    );
  }

  // Legacy mode (no keychain available): key lives in the form and is saved to disk.
  const value = form[config.field] as string | null | undefined;
  return (
    <Box>
      {header}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          type={showApiKey ? 'text' : 'password'}
          value={value ?? ''}
          onChange={(e) => setForm({ ...form, [config.field]: e.target.value || null })}
          size="small"
          fullWidth
          placeholder={config.placeholder}
          sx={{ ...fieldSx, '& .MuiOutlinedInput-root': { ...fieldSx['& .MuiOutlinedInput-root'], fontFamily: c.font.mono } }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setShowApiKey(!showApiKey)} edge="end" size="small" sx={{ color: c.text.tertiary }}>
                  {showApiKey ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <GetKeyLink href={config.href} />
      </Box>
    </Box>
  );
};

export default ApiKeyCard;
