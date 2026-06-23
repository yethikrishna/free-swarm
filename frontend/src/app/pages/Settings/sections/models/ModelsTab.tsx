import React, { useMemo, useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { AppSettings } from '@/shared/state/settingsSlice';
import { useProviderStatus } from '@/shared/hooks/useProviderStatus';
import { keychainAvailable, fetchSecretsPresent } from '@/shared/keychain';
import FreeSwarmProCard from '../subscription/FreeSwarmProCard';
import SubscriptionCards from '../subscription/SubscriptionCards';
import ApiKeyCard, { API_KEY_CARDS } from './ApiKeyCard';
import CustomProvidersEditor from './CustomProvidersEditor';
import CombosEditor from './CombosEditor';
import ModelAliasesEditor from './ModelAliasesEditor';
import type { SettingsStyles } from '../settingsStyles';

const ModelsTab: React.FC<{
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  showApiKey: boolean;
  setShowApiKey: (v: boolean) => void;
  styles: SettingsStyles;
}> = ({ form, setForm, showApiKey, setShowApiKey, styles }) => {
  const c = useClaudeTokens();
  const { descSx } = styles;
  const { byId: providerStatus, routerOffline, loading: statusLoading, refresh } = useProviderStatus();

  // When the OS keychain is available, provider keys are managed there (not in the
  // settings form / settings.json). `present` says which keys the backend currently
  // holds so the cards can show a "stored securely" state instead of an empty field.
  const useKeychain = keychainAvailable();
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const refreshPresent = useCallback(() => {
    if (useKeychain) fetchSecretsPresent().then(setPresent);
  }, [useKeychain]);
  useEffect(() => { refreshPresent(); }, [refreshPresent]);

  const allModels = useMemo(() => {
    const models: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();

    form.custom_providers?.forEach(provider => {
      provider.models.forEach(m => {
        if (!seen.has(m.value)) {
          seen.add(m.value);
          models.push(m);
        }
      });
    });

    return models;
  }, [form.custom_providers]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', pt: 2.5, pb: 1, gap: 2.5, animation: 'fadeIn 0.2s ease', '@keyframes fadeIn': { from: { opacity: 0 }, to: { opacity: 1 } } }}>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography sx={{ fontSize: '0.7rem', color: c.text.ghost, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
          Connect a Subscription
        </Typography>

        <Typography sx={{ ...descSx, mb: 0 }}>
          Already paying for Claude, ChatGPT, or Gemini? Connect it here at no extra cost. Or let FreeSwarm Pro cover everything in one subscription.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box data-onboarding="settings-pro-section">
            <FreeSwarmProCard />
          </Box>
          <Box data-onboarding="settings-external-subs">
            <SubscriptionCards />
          </Box>
        </Box>
      </Box>

      <Box data-onboarding="settings-api-keys" sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
          <Typography sx={{ fontSize: '0.7rem', color: c.text.ghost, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            Or Connect With API Keys
          </Typography>
          <Tooltip title={routerOffline ? 'Router offline' : 'Refresh status'} arrow placement="top">
            <span>
              <IconButton
                size="small"
                onClick={refresh}
                disabled={statusLoading}
                sx={{ color: c.text.muted, '&:hover': { color: c.text.primary } }}
              >
                <RefreshIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        <Typography sx={{ ...descSx, mb: -1 }}>
          {useKeychain
            ? 'Pay per use. Each key is stored securely in your operating system keychain.'
            : 'Pay per use. Each key is stored locally on your device.'}
        </Typography>

        {API_KEY_CARDS.map((config) => (
          <ApiKeyCard
            key={config.field}
            config={config}
            form={form}
            setForm={setForm}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            styles={styles}
            status={providerStatus[config.providerId]}
            routerOffline={routerOffline}
            useKeychain={useKeychain}
            stored={!!present[config.field]}
            onKeychainChange={refreshPresent}
          />
        ))}

        <CustomProvidersEditor
          form={form}
          setForm={setForm}
          showApiKey={showApiKey}
          setShowApiKey={setShowApiKey}
          styles={styles}
        />

        <CombosEditor
          form={form}
          setForm={setForm}
          allModels={allModels}
          styles={styles}
        />

        <ModelAliasesEditor
          form={form}
          setForm={setForm}
          allModels={allModels}
          styles={styles}
        />
      </Box>

    </Box>
  );
};

export default ModelsTab;
