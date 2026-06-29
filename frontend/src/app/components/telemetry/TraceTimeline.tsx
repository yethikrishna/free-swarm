// Tier 1 observability: a per-session span timeline. Fetches the trace from
// /api/tracing/session/:id (the latency fields aren't on the Redux session
// type, so we pull the computed trace on demand) and renders tool + model
// spans as proportional bars + a summary. Refetches when the panel opens or the
// session's cost changes (a cheap "the run advanced" signal).

import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useAppSelector } from '@/shared/hooks';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { ClaudeTokens } from '@/shared/styles/claudeTokens';
import { API_BASE, getAuthToken } from '@/shared/config';

interface Span { tool?: string; model?: string; total_ms?: number; ms?: number; calls?: number; avg_ms?: number; pct_of_active: number; }
interface Trace {
  summary: { active_ms: number; cost_usd: number; tool_calls: number; distinct_tools: number; input_tokens: number; output_tokens: number; models_used: number };
  tools: Span[];
  models: Span[];
  hotspots: Span[];
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

const Bar: React.FC<{ label: string; right: string; pct: number; c: ClaudeTokens }> = ({ label, right, pct, c }) => (
  <Box sx={{ mb: 0.75 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
      <Typography sx={{ fontSize: 12, color: c.text.secondary }}>{label}</Typography>
      <Typography sx={{ fontSize: 11, color: c.text.muted }}>{right}</Typography>
    </Box>
    <Box sx={{ height: 5, borderRadius: 3, bgcolor: c.bg.secondary, overflow: 'hidden' }}>
      <Box sx={{
        height: '100%', width: `${Math.max(2, Math.min(100, pct))}%`,
        bgcolor: c.accent.primary, borderRadius: 3, transition: 'width 300ms ease-in-out',
      }} />
    </Box>
  </Box>
);

export const TraceTimeline: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const c = useClaudeTokens();
  const costUsd = useAppSelector((s) => s.agents.sessions[sessionId]?.cost_usd);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tok = (() => { try { return getAuthToken(); } catch { return ''; } })();
        const headers: Record<string, string> = {};
        if (tok) headers['Authorization'] = `Bearer ${tok}`;
        const r = await fetch(`${API_BASE}/tracing/session/${sessionId}`, { headers });
        if (!r.ok) { if (!cancelled) setErr(true); return; }
        const data = await r.json();
        if (!cancelled) { setTrace(data); setErr(false); }
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, costUsd]);

  if (err) return <Typography sx={{ fontSize: 12, color: c.text.muted, p: 1 }}>Timing not available yet.</Typography>;
  if (!trace) return <Typography sx={{ fontSize: 12, color: c.text.muted, p: 1 }}>Loading timing...</Typography>;
  if (!trace.tools.length && !trace.models.length) {
    return <Typography sx={{ fontSize: 12, color: c.text.muted, p: 1 }}>No tool activity yet.</Typography>;
  }

  return (
    <Box sx={{ p: 1 }}>
      <Typography sx={{ fontSize: 11, color: c.text.muted, mb: 1 }}>
        {trace.summary.tool_calls} tool calls across {trace.summary.distinct_tools} tools, {fmtMs(trace.summary.active_ms)} active
      </Typography>
      {trace.tools.map((t) => (
        <Bar key={t.tool} label={t.tool || ''} right={`${fmtMs(t.total_ms || 0)} (${t.calls}x)`} pct={t.pct_of_active} c={c} />
      ))}
      {trace.models.length > 0 && (
        <Box sx={{ mt: 1.25 }}>
          <Typography sx={{ fontSize: 11, color: c.text.muted, mb: 0.5 }}>Model time</Typography>
          {trace.models.map((m) => (
            <Bar key={m.model} label={m.model || ''} right={fmtMs(m.ms || 0)} pct={m.pct_of_active} c={c} />
          ))}
        </Box>
      )}
    </Box>
  );
};

export default TraceTimeline;
