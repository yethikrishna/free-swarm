// F4 + F7: cost dashboard. Totals, a simple per-day bar sparkline (no chart
// dependency, just flex bars), and the top models by spend.
import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { costSummary } from '@/shared/cloud';
import { PanelTitle, Row, Empty, Loading, ErrorNote, useAsync } from './ui';

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

const CostPanel: React.FC<{ token: string }> = ({ token }) => {
  const { data, loading, error } = useAsync(() => costSummary(token, 30), [token]);
  const max = data ? Math.max(1, ...data.by_day.map((d) => d.cost_usd)) : 1;

  return (
    <Box>
      <PanelTitle hint="Your model usage cost over the last 30 days.">Cost</PanelTitle>
      {loading ? <Loading /> : error ? <ErrorNote>{error}</ErrorNote> : !data ? null : (
        <>
          <Box sx={{ display: 'flex', gap: 3, mb: 3 }}>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>{usd(data.total_usd)}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>spent</Typography>
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>{data.total_calls.toLocaleString()}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>calls</Typography>
            </Box>
          </Box>

          {data.by_day.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 80, mb: 3 }}>
              {data.by_day.map((d) => (
                <Tooltip key={d.day} title={`${d.day}: ${usd(d.cost_usd)}`} arrow>
                  <Box sx={{ flex: 1, height: `${Math.max(4, (d.cost_usd / max) * 100)}%`, bgcolor: '#6366f1', borderRadius: '2px 2px 0 0', minWidth: 3 }} />
                </Tooltip>
              ))}
            </Box>
          )}

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Top models</Typography>
          {!data.by_model.length ? <Empty>No usage recorded yet.</Empty> : data.by_model.map((m) => (
            <Row key={`${m.provider}/${m.model}`}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.model}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{m.provider} · {m.calls} calls</Typography>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{usd(m.cost_usd)}</Typography>
            </Row>
          ))}
        </>
      )}
    </Box>
  );
};

export default CostPanel;
