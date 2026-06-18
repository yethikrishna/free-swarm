import React, { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import MultiAccountManager, { type MultiAccountManagerHandle } from './MultiAccountManager';
import type { SubscriptionProvider } from './subscriptionProviders';

const SubscriptionCard: React.FC<{ provider: SubscriptionProvider; connected: boolean; onConnect: () => void; onDisconnect: () => void; connecting: boolean; userCode?: string; disconnecting?: boolean; onAccountsChange?: () => void }> = ({ provider, connected, onConnect, onDisconnect, connecting, userCode, disconnecting, onAccountsChange }) => {
  const [showAccountManager, setShowAccountManager] = useState(false);
  const c = useClaudeTokens();
  const isPreview = (provider as any).preview;
  const dotColor = connected ? c.status.success : connecting ? c.accent.primary : c.border.medium;
  const managerRef = useRef<MultiAccountManagerHandle>(null);
  const wasConnecting = useRef(false);

  useEffect(() => {
    if (wasConnecting.current && !connecting) {
      managerRef.current?.refresh();
    }
    wasConnecting.current = connecting;
  }, [connecting]);

  return (
    <Box sx={{
      p: 1.5, borderRadius: `${c.radius.md}px`,
      border: `1px solid ${connected ? c.status.success + '30' : connecting ? c.accent.primary + '30' : c.border.subtle}`,
      bgcolor: connected ? `${c.status.success}06` : connecting ? `${c.accent.primary}06` : 'transparent',
      opacity: isPreview ? 0.5 : 1,
      transition: c.transition,
      '&:hover': isPreview ? {} : {
        borderColor: connected ? c.status.success + '4d' : c.border.medium,
        boxShadow: c.shadow.sm,
      },
      // affirm "Connected" at rest, reveal "Disconnect" on hover so the undo never shouts
      '&:hover .sub-rest': { opacity: 0 },
      '&:hover .sub-undo': { opacity: 1, pointerEvents: 'auto' },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: dotColor,
            transition: 'background-color 0.3s ease',
            ...(connecting ? {
              animation: 'sub-pulse 1.4s ease-in-out infinite',
              '@keyframes sub-pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
            } : {}),
          }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: c.text.primary }}>{provider.name}</Typography>
            <Typography noWrap sx={{ fontSize: '0.65rem', color: connecting ? c.accent.primary : c.text.muted, transition: 'color 0.2s ease' }}>
              {connecting ? 'Waiting for authorization...' : provider.desc}
            </Typography>
          </Box>
        </Box>

        {isPreview ? (
          <Typography sx={{ fontSize: '0.65rem', color: c.text.ghost, fontStyle: 'italic', flexShrink: 0 }}>
            Coming soon
          </Typography>
        ) : connected ? (
          disconnecting ? (
            <CircularProgress size={14} sx={{ color: c.text.ghost }} />
          ) : (
            <Box sx={{ position: 'relative', flexShrink: 0, minWidth: 72, height: 16 }}>
              <Typography className="sub-rest" sx={{ position: 'absolute', right: 0, top: 0, fontSize: '0.68rem', fontWeight: 500, color: c.status.success, transition: 'opacity 0.18s ease' }}>
                Connected
              </Typography>
              <Typography className="sub-undo" onClick={onDisconnect} sx={{ position: 'absolute', right: 0, top: 0, fontSize: '0.68rem', color: c.text.tertiary, cursor: 'pointer', opacity: 0, pointerEvents: 'none', transition: 'opacity 0.18s ease', '&:hover': { color: c.status.error } }}>
                Disconnect
              </Typography>
            </Box>
          )
        ) : connecting && userCode ? (
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.68rem', color: c.text.muted }}>Enter code:</Typography>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: c.accent.primary, fontFamily: c.font.mono, letterSpacing: '0.1em' }}>{userCode}</Typography>
          </Box>
        ) : connecting ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexShrink: 0 }}>
            <CircularProgress size={14} sx={{ color: c.accent.primary }} />
            <Typography sx={{ fontSize: '0.68rem', color: c.accent.primary }}>Connecting...</Typography>
          </Box>
        ) : (
          <Button onClick={onConnect} variant="outlined" size="small" sx={{ textTransform: 'none', fontSize: '0.7rem', fontWeight: 600, color: c.text.primary, borderColor: c.border.medium, borderRadius: `${c.radius.sm}px`, minWidth: 72, flexShrink: 0, '&:hover': { borderColor: c.accent.primary, bgcolor: `${c.accent.primary}0a` }, transition: 'all 0.2s ease' }}>
            Connect
          </Button>
        )}
      </Box>

      {connected && (
        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${c.border.subtle}`, display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button
            size="small"
            onClick={() => setShowAccountManager(!showAccountManager)}
            sx={{
              textTransform: 'none',
              fontSize: '0.7rem',
              color: c.text.muted,
              '&:hover': { color: c.accent.primary },
              flex: 1,
            }}
          >
            {showAccountManager ? 'Hide accounts' : 'Manage accounts'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={connecting}
            onClick={() => {
              // Reveal the manager so the newly authorized account is visible when it lands.
              setShowAccountManager(true);
              onConnect?.();
            }}
            sx={{
              textTransform: 'none',
              fontSize: '0.7rem',
              py: 0.25,
              px: 1,
              color: c.text.primary,
              borderColor: c.border.medium,
              '&:hover': { borderColor: c.accent.primary, bgcolor: `${c.accent.primary}0a` },
              flexShrink: 0,
            }}
          >
            {connecting ? 'Adding...' : '+ Add'}
          </Button>
        </Box>
      )}

      {connected && showAccountManager && (
        <Box sx={{ mt: 1 }}>
          <MultiAccountManager
            ref={managerRef}
            provider={provider.id}
            onAccountsChange={() => {
              if (onAccountsChange) onAccountsChange();
            }}
          />
        </Box>
      )}
    </Box>
  );
};

export default SubscriptionCard;
