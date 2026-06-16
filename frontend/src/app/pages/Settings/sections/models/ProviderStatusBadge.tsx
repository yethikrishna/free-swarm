import React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { ProviderStatus } from '@/shared/hooks/useProviderStatus';

interface ProviderStatusBadgeProps {
  status?: ProviderStatus;
  routerOffline?: boolean;
}

/** Small colored dot reflecting one provider's health, with a plain-English
 *  tooltip. Absent status means no connection yet (not configured). */
const ProviderStatusBadge: React.FC<ProviderStatusBadgeProps> = ({ status, routerOffline }) => {
  const c = useClaudeTokens();

  let color = c.text.ghost;
  let label = 'Not connected';

  if (routerOffline) {
    color = c.text.ghost;
    label = 'Router offline';
  } else if (!status || !status.configured) {
    color = c.status.warning;
    label = 'Not connected';
  } else if (status.status === 'ok') {
    color = c.status.success;
    label = 'Connected';
  } else if (status.status === 'error') {
    color = c.status.error;
    label = status.lastError ? `Error: ${status.lastError}` : 'Connection error';
  } else {
    color = c.text.ghost;
    label = 'Status unknown';
  }

  const checkedAt = status?.lastChecked
    ? new Date(status.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const tooltip = checkedAt ? `${label} · checked ${checkedAt}` : label;

  return (
    <Tooltip title={tooltip} arrow placement="top">
      <Box
        component="span"
        sx={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
};

export default ProviderStatusBadge;
