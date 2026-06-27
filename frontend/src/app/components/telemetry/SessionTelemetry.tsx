// P3 live telemetry panel. Reads the per-session cost + context figures the
// WebSocketManager already streams into Redux (updateSessionCost /
// updateSessionContext), so it updates live as the agent runs without any new
// data plumbing. Pure presentation over existing state.

import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useAppSelector } from '@/shared/hooks';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { ClaudeTokens } from '@/shared/styles/claudeTokens';

function fmtUsd(n: number): string {
  if (!n) return '$0.00';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n || 0);
}

const Meter: React.FC<{ label: string; pct: number; hint: string; c: ClaudeTokens }> = ({ label, pct, hint, c }) => {
  const clamped = Math.max(0, Math.min(100, pct));
  // Stay calm under normal load; only warm toward the accent as context fills.
  const fill = clamped < 70 ? c.accent.primary : clamped < 90 ? '#c9883a' : '#b5483a';
  return (
    <Box sx={{ mb: 1.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: 12, color: c.text.secondary }}>{label}</Typography>
        <Typography sx={{ fontSize: 12, color: c.text.muted }}>{hint}</Typography>
      </Box>
      <Box sx={{ height: 6, borderRadius: 3, bgcolor: c.bg.secondary, overflow: 'hidden' }}>
        <Box sx={{
          height: '100%', width: `${clamped}%`, bgcolor: fill, borderRadius: 3,
          transition: 'width 300ms ease-in-out, background-color 300ms ease-in-out',
        }} />
      </Box>
    </Box>
  );
};

const Stat: React.FC<{ label: string; value: string; c: ClaudeTokens }> = ({ label, value, c }) => (
  <Box sx={{ flex: 1 }}>
    <Typography sx={{ fontSize: 18, fontWeight: 600, color: c.text.primary, lineHeight: 1.2 }}>{value}</Typography>
    <Typography sx={{ fontSize: 11, color: c.text.muted }}>{label}</Typography>
  </Box>
);

export const SessionTelemetry: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const c = useClaudeTokens();
  const session = useAppSelector((s) => s.agents.sessions[sessionId]);
  if (!session) return null;

  const ctxPct = Math.round((session.ctx_used_pct ?? 0) * 100);
  const cachePct = Math.round((session.cache_read_pct ?? 0) * 100);
  const input = session.tokens?.input ?? 0;
  const output = session.tokens?.output ?? 0;

  return (
    <Box sx={{
      p: 1.75, borderRadius: 2, bgcolor: c.bg.surface,
      border: `${c.border.width} solid ${c.border.medium}`,
    }}>
      <Box sx={{ display: 'flex', gap: 2, mb: 1.75 }}>
        <Stat label="Spent this session" value={fmtUsd(session.cost_usd ?? 0)} c={c} />
        <Stat label="Tokens in" value={fmtTokens(input)} c={c} />
        <Stat label="Tokens out" value={fmtTokens(output)} c={c} />
      </Box>
      <Meter label="Context window" pct={ctxPct} hint={`${ctxPct}% used`} c={c} />
      <Meter label="Cache hit rate" pct={cachePct} hint={`${cachePct}%`} c={c} />
      {!!(session.active_mcps && session.active_mcps.length) && (
        <Typography sx={{ fontSize: 11, color: c.text.muted, mt: 0.5 }}>
          {session.active_mcps.length} tool {session.active_mcps.length === 1 ? 'service' : 'services'} active
        </Typography>
      )}
    </Box>
  );
};

export default SessionTelemetry;
