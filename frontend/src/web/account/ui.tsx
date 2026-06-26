// Shared primitives for the web account portal panels (F1-F13). Light MUI to
// match WebApp's account theme; keeps each feature panel declarative + small.
import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';

export const PanelTitle: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
  <Box sx={{ mb: 2 }}>
    <Typography variant="h6" sx={{ fontWeight: 700 }}>{children}</Typography>
    {hint && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{hint}</Typography>}
  </Box>
);

export const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1.25, borderBottom: '1px solid #f3f4f6' }}>
    {children}
  </Box>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>{children}</Typography>
);

export const Loading: React.FC = () => (
  <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></Box>
);

export const ErrorNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Alert severity="warning" sx={{ my: 1 }}>{children}</Alert>
);

// Wraps a panel's load/error/empty boilerplate so each panel only writes content.
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): {
  data: T | null; loading: boolean; error: string | null; reload: () => void;
} {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
