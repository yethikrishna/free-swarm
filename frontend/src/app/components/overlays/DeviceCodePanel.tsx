// Desktop side of the device-code sign-in (RFC 8628). Renders inside
// SignInDialog when the user picks "Sign in with a code": starts a flow on the
// local backend, shows the short user_code + a button to open the approval page,
// and polls until the cloud reports approved/denied/expired. The secret
// device_code stays in the backend; we only hold an opaque flow_id.
import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { API_BASE } from '@/shared/config';
import { report } from '@/shared/serviceClient';

interface DeviceStart {
  flow_id: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

export default function DeviceCodePanel({
  onApproved,
  onBack,
}: {
  onApproved: () => void;
  onBack: () => void;
}): JSX.Element {
  const tokens = useClaudeTokens();
  const [data, setData] = useState<DeviceStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stoppedRef = useRef(false);
  const flowRef = useRef<string | null>(null);
  // Keep the latest onApproved without making it an effect dep: the parent
  // (SignInDialog) passes an inline arrow, and depending on it would tear down
  // and restart the whole flow (a fresh code) on any parent re-render.
  const onApprovedRef = useRef(onApproved);
  onApprovedRef.current = onApproved;

  useEffect(() => {
    stoppedRef.current = false;
    let cancelled = false;

    const poll = (flowId: string, intervalMs: number) => {
      if (stoppedRef.current) return;
      window.setTimeout(async () => {
        if (stoppedRef.current) return;
        try {
          const r = await fetch(`${API_BASE}/auth/device/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flow_id: flowId }),
          });
          const d = (await r.json()) as { status?: string; interval?: number };
          if (stoppedRef.current) return;
          if (d.status === 'approved') {
            stoppedRef.current = true;
            report('signin', 'device_approved');
            onApprovedRef.current();
            return;
          }
          if (d.status === 'denied') {
            stoppedRef.current = true;
            setError('That request was declined. You can try again.');
            return;
          }
          if (d.status === 'expired') {
            stoppedRef.current = true;
            setError('That code expired. Start again to get a new one.');
            return;
          }
          poll(flowId, Math.max(2000, (d.interval || intervalMs / 1000) * 1000));
        } catch {
          poll(flowId, Math.max(3000, intervalMs));
        }
      }, intervalMs);
    };

    (async () => {
      try {
        const r = await fetch(`${API_BASE}/auth/device/start`, { method: 'POST' });
        if (!r.ok) throw new Error('start failed');
        const d = (await r.json()) as DeviceStart;
        if (cancelled) return;
        flowRef.current = d.flow_id;
        setData(d);
        report('signin', 'device_started');
        poll(d.flow_id, (d.interval || 5) * 1000);
      } catch {
        if (!cancelled) setError("We couldn't start a code sign-in. Check your connection and try again.");
      }
    })();

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      const fid = flowRef.current;
      flowRef.current = null;
      if (fid) {
        // Best-effort: free the server-side flow when the panel goes away.
        fetch(`${API_BASE}/auth/device/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flow_id: fid }),
        }).catch(() => undefined);
      }
    };
  }, [attempt]);

  const openPage = () => {
    if (!data) return;
    const api = (window as any).freeswarm;
    const url = data.verification_uri_complete || data.verification_uri;
    if (api?.openExternal) api.openExternal(url);
    else window.open(url, '_blank');
  };

  const restart = () => {
    setError(null);
    setData(null);
    setAttempt((a) => a + 1);
  };

  if (error) {
    return (
      <>
        <Typography variant="h5" sx={{ fontFamily: '"Charter", Georgia, serif', fontWeight: 500, mb: 1 }}>
          Sign-in with a code
        </Typography>
        <Typography variant="body2" sx={{ color: tokens.text.muted, mb: 3, lineHeight: 1.5 }}>
          {error}
        </Typography>
        <Button variant="contained" onClick={restart} sx={{ textTransform: 'none', mr: 1 }}>
          Try again
        </Button>
        <Button variant="text" onClick={onBack} sx={{ textTransform: 'none', color: tokens.text.muted }}>
          Use a different method
        </Button>
      </>
    );
  }

  if (!data) {
    return (
      <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={28} sx={{ color: tokens.accent.primary }} />
      </Box>
    );
  }

  const host = (() => {
    try {
      return new URL(data.verification_uri).host;
    } catch {
      return data.verification_uri;
    }
  })();

  return (
    <>
      <Typography variant="h5" sx={{ fontFamily: '"Charter", Georgia, serif', fontWeight: 500, mb: 1 }}>
        Enter this code to sign in
      </Typography>
      <Typography variant="body2" sx={{ color: tokens.text.muted, mb: 2.5, lineHeight: 1.5 }}>
        On any signed-in browser, open <b>{host}/device</b> and enter the code below.
      </Typography>

      <Box
        sx={{
          fontFamily: 'monospace',
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: 6,
          py: 1.5,
          mb: 2,
          borderRadius: 2,
          backgroundColor: tokens.bg.elevated,
          color: tokens.text.primary,
          userSelect: 'all',
        }}
      >
        {data.user_code}
      </Box>

      <Button
        fullWidth
        variant="contained"
        onClick={openPage}
        sx={{
          py: 1.2,
          mb: 2,
          backgroundColor: tokens.text.primary,
          color: tokens.text.inverse,
          textTransform: 'none',
          fontSize: 15,
          fontWeight: 500,
          '&:hover': { backgroundColor: tokens.text.primary, opacity: 0.9 },
        }}
      >
        Open the sign-in page
      </Button>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1 }}>
        <CircularProgress size={16} sx={{ color: tokens.accent.primary }} />
        <Typography variant="body2" sx={{ color: tokens.text.muted }}>
          Waiting for you to approve...
        </Typography>
      </Box>

      <Button variant="text" onClick={onBack} sx={{ textTransform: 'none', fontSize: 13, color: tokens.text.muted }}>
        Use a different method
      </Button>
    </>
  );
}
