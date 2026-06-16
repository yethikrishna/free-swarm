import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/shared/config';

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  status: 'ok' | 'error' | 'unknown';
  lastError?: string | null;
  lastChecked?: string | null;
}

interface ProviderStatusResponse {
  routerStatus: 'ok' | 'offline';
  providers: ProviderStatus[];
  lastChecked?: string | null;
}

interface UseProviderStatus {
  byId: Record<string, ProviderStatus>;
  routerOffline: boolean;
  loading: boolean;
  refresh: () => void;
}

const POLL_MS = 60_000;
// Collapse bursty triggers (save + background tick) into one request.
const MIN_INTERVAL_MS = 3_000;

/** Provider health backed by 9router, via the FreeSwarm passthrough.
 *  Fetches on mount, polls every 60s while mounted, and exposes a throttled
 *  manual refresh. Router-offline is surfaced so badges never go stale-green. */
export function useProviderStatus(): UseProviderStatus {
  const [byId, setById] = useState<Record<string, ProviderStatus>>({});
  const [routerOffline, setRouterOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (inFlightRef.current) return;
    if (Date.now() - lastFetchRef.current < MIN_INTERVAL_MS) return;
    inFlightRef.current = true;
    lastFetchRef.current = Date.now();
    try {
      const res = await fetch(`${API_BASE}/agents/providers/status`);
      const data = (await res.json()) as ProviderStatusResponse;
      setRouterOffline(data.routerStatus === 'offline');
      const map: Record<string, ProviderStatus> = {};
      for (const p of data.providers || []) map[p.id] = p;
      setById(map);
    } catch (err) {
      console.error('Provider status fetch failed:', err);
      setRouterOffline(true);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = window.setInterval(fetchStatus, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchStatus]);

  return { byId, routerOffline, loading, refresh: fetchStatus };
}
