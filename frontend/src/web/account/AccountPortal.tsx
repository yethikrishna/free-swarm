// Tabbed account portal for the web build. The overview keeps the original
// plan/subscription card; the other tabs host the F1-F13 feature panels. Wider
// container than the sign-in card so tables/forms breathe.
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { CloudMe, subscriptionSync } from '@/shared/cloud';
import SessionsPanel from './SessionsPanel';
import SecurityPanel from './SecurityPanel';
import ApiKeysPanel from './ApiKeysPanel';
import TeamsPanel from './TeamsPanel';
import CostPanel from './CostPanel';
import AuditPanel from './AuditPanel';
import BrandingPanel from './BrandingPanel';
import NotificationsPanel from './NotificationsPanel';
import SharePanel from './SharePanel';

const TABS = [
  'Overview', 'Sessions', 'Security', 'API keys', 'Teams',
  'Cost', 'Notifications', 'Share', 'Branding', 'Activity',
];

const Overview: React.FC<{ me: CloudMe; token: string; onRefresh: () => void }> = ({ me, token, onRefresh }) => {
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    try { await subscriptionSync(token); onRefresh(); } finally { setSyncing(false); }
  };
  const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 1, borderBottom: '1px solid #f3f4f6' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
  return (
    <Box>
      <Row label="Email" value={me.email} />
      <Row label="Plan" value={me.plan} />
      <Row label="Status" value={me.status} />
      <Row label="Renews" value={me.expires ? new Date(me.expires).toLocaleDateString() : 'No active subscription'} />
      <Button variant="outlined" onClick={sync} disabled={syncing} sx={{ mt: 3 }}>
        {syncing ? <CircularProgress size={20} /> : 'Sync subscription'}
      </Button>
    </Box>
  );
};

const AccountPortal: React.FC<{ me: CloudMe; token: string; onRefresh: () => void; onSignOut: () => void }> = ({
  me, token, onRefresh, onSignOut,
}) => {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f9fafb', py: { xs: 2, md: 5 }, px: 2 }}>
      <Paper elevation={0} sx={{ maxWidth: 760, mx: 'auto', border: '1px solid #e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, pt: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Your account</Typography>
          <Button variant="text" onClick={onSignOut} sx={{ color: 'text.secondary' }}>Sign out</Button>
        </Box>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: '1px solid #e5e7eb', minHeight: 44 }}
        >
          {TABS.map((t) => <Tab key={t} label={t} sx={{ textTransform: 'none', minHeight: 44 }} />)}
        </Tabs>
        <Box sx={{ p: 3 }}>
          {tab === 0 && <Overview me={me} token={token} onRefresh={onRefresh} />}
          {tab === 1 && <SessionsPanel token={token} />}
          {tab === 2 && <SecurityPanel token={token} />}
          {tab === 3 && <ApiKeysPanel token={token} />}
          {tab === 4 && <TeamsPanel token={token} />}
          {tab === 5 && <CostPanel token={token} />}
          {tab === 6 && <NotificationsPanel token={token} />}
          {tab === 7 && <SharePanel token={token} />}
          {tab === 8 && <BrandingPanel token={token} />}
          {tab === 9 && <AuditPanel token={token} />}
        </Box>
      </Paper>
    </Box>
  );
};

export default AccountPortal;
