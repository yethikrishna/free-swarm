import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ArrowUpIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownIcon from '@mui/icons-material/ArrowDownward';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { ProviderStatus } from '@/shared/hooks/useProviderStatus';
import ProviderStatusBadge from '../models/ProviderStatusBadge';

export interface Account {
  id: string;
  email?: string;
  name?: string;
  displayName?: string;
  isActive?: boolean;
  testStatus?: string;
  lastError?: string | null;
  lastErrorAt?: string | null;
  priority?: number;
  lastUsedAt?: string;
  consecutiveUseCount?: number;
}

/** Map a 9router connection's test fields to the shared badge's status shape. */
export function accountToStatus(a: Account): ProviderStatus {
  let status: ProviderStatus['status'] = 'unknown';
  if (a.lastError || a.testStatus === 'unavailable') status = 'error';
  else if ((a.testStatus === 'active' || a.testStatus === 'success') && a.isActive !== false) status = 'ok';
  return {
    id: a.id,
    name: a.displayName || a.email || a.name || '',
    configured: true,
    status,
    lastError: a.lastError,
    lastChecked: a.lastErrorAt,
  };
}

/** "2h ago" relative time for last-used; empty when never used. */
function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

interface AccountRowProps {
  account: Account;
  isFirst: boolean;
  isLast: boolean;
  reorderable: boolean;
  showRotation: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMenuOpen: (el: HTMLElement) => void;
}

const AccountRow: React.FC<AccountRowProps> = ({
  account, isFirst, isLast, reorderable, showRotation, onMoveUp, onMoveDown, onMenuOpen,
}) => {
  const c = useClaudeTokens();
  const used = relativeTime(account.lastUsedAt);
  // Consecutive-use count makes round-robin's sticky window legible.
  const rotation = showRotation && (used || account.consecutiveUseCount)
    ? [used && `used ${used}`, account.consecutiveUseCount ? `${account.consecutiveUseCount}x in a row` : '']
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        p: 1,
        borderRadius: `${c.radius.sm}px`,
        bgcolor: c.bg.surface,
        border: `1px solid ${c.border.subtle}`,
      }}
    >
      {reorderable && (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <IconButton size="small" onClick={onMoveUp} disabled={isFirst} sx={{ p: 0.1, color: isFirst ? c.text.ghost : c.text.muted }}>
            <ArrowUpIcon sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton size="small" onClick={onMoveDown} disabled={isLast} sx={{ p: 0.1, color: isLast ? c.text.ghost : c.text.muted }}>
            <ArrowDownIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Box>
      )}

      <ProviderStatusBadge status={accountToStatus(account)} />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: '0.75rem', color: c.text.primary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {account.displayName || account.email || account.name || 'Unknown'}
        </Typography>
        {rotation && (
          <Typography sx={{ fontSize: '0.65rem', color: c.text.muted, mt: 0.15 }}>
            {rotation}
          </Typography>
        )}
      </Box>

      <IconButton
        size="small"
        onClick={(e) => onMenuOpen(e.currentTarget)}
        sx={{ color: c.text.muted }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default AccountRow;
