import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteIcon from '@mui/icons-material/Delete';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { API_BASE } from '@/shared/config';
import AccountRow, { Account } from './AccountRow';

interface MultiAccountManagerProps {
  provider: string;
  onAccountsChange: () => void;
}

const MultiAccountManager: React.FC<MultiAccountManagerProps> = ({ provider, onAccountsChange }) => {
  const c = useClaudeTokens();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<'fill-first' | 'round-robin'>('fill-first');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/agents/subscriptions/${provider}/accounts`);
      const data = await res.json();
      if (data.ok) {
        setAccounts(data.accounts);
        if (data.strategy === 'round-robin' || data.strategy === 'fill-first') {
          setStrategy(data.strategy);
        }
        setError(null);
      } else {
        setError(data.error || 'Failed to load accounts');
      }
    } catch (err) {
      setError('Failed to fetch accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [provider]);

  const deleteAccount = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`${API_BASE}/agents/subscriptions/${provider}/accounts/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        setAccounts(accounts.filter(a => a.id !== id));
        onAccountsChange();
      } else {
        setError(data.error || 'Failed to delete account');
      }
    } catch (err) {
      setError('Failed to delete account');
    } finally {
      setDeletingId(null);
      setMenuAnchor(null);
    }
  };

  const reorder = async (from: number, to: number) => {
    if (to < 0 || to >= accounts.length) return;
    const next = [...accounts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setAccounts(next); // optimistic; refetch only on failure to avoid a flash
    try {
      const res = await fetch(`${API_BASE}/agents/subscriptions/${provider}/accounts/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: next.map(a => a.id) }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to reorder');
        fetchAccounts();
      }
    } catch (err) {
      setError('Failed to reorder');
      fetchAccounts();
    }
  };

  const setRoutingStrategy = async (newStrategy: 'fill-first' | 'round-robin') => {
    try {
      const res = await fetch(`${API_BASE}/agents/subscriptions/${provider}/strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: newStrategy,
          stickyRoundRobinLimit: 3,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStrategy(newStrategy);
        setError(null);
      } else {
        setError(data.error || 'Failed to set strategy');
      }
    } catch (err) {
      setError('Failed to set strategy');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (accounts.length === 0) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, bgcolor: c.bg.elevated, borderRadius: `${c.radius.md}px`, border: `1px solid ${c.border.subtle}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: c.text.primary }}>
          {accounts.length} account{accounts.length !== 1 ? 's' : ''}
        </Typography>
        {accounts.length > 1 && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button
              size="small"
              variant={strategy === 'fill-first' ? 'contained' : 'outlined'}
              onClick={() => setRoutingStrategy('fill-first')}
              sx={{
                textTransform: 'none',
                fontSize: '0.7rem',
                py: 0.25,
                px: 1,
                minWidth: 'auto',
              }}
            >
              Use first
            </Button>
            <Button
              size="small"
              variant={strategy === 'round-robin' ? 'contained' : 'outlined'}
              onClick={() => setRoutingStrategy('round-robin')}
              sx={{
                textTransform: 'none',
                fontSize: '0.7rem',
                py: 0.25,
                px: 1,
                minWidth: 'auto',
              }}
            >
              Round-robin
            </Button>
          </Box>
        )}
      </Box>

      {error && (
        <Typography sx={{ fontSize: '0.7rem', color: c.status.error }}>
          {error}
        </Typography>
      )}

      {accounts.map((account, idx) => (
        <AccountRow
          key={account.id}
          account={account}
          isFirst={idx === 0}
          isLast={idx === accounts.length - 1}
          reorderable={accounts.length > 1}
          showRotation={strategy === 'round-robin'}
          onMoveUp={() => reorder(idx, idx - 1)}
          onMoveDown={() => reorder(idx, idx + 1)}
          onMenuOpen={(el) => {
            setSelectedAccount(account.id);
            setMenuAnchor(el);
          }}
        />
      ))}

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor && selectedAccount)}
        onClose={() => {
          setMenuAnchor(null);
          setSelectedAccount(null);
        }}
      >
        <MenuItem
          onClick={() => selectedAccount && deleteAccount(selectedAccount)}
          disabled={deletingId === selectedAccount}
          sx={{ fontSize: '0.8rem', color: 'error.main' }}
        >
          {deletingId === selectedAccount ? <CircularProgress size={16} /> : <DeleteIcon sx={{ mr: 1, fontSize: 18 }} />}
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default MultiAccountManager;
