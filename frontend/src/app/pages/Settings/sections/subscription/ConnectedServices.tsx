import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

export const GitHubIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 6, flexShrink: 0 }}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

/** Connected-services list (Google "coming soon", GitHub connect/connected). Shared by desktop and web account cards. */
const ConnectedServices: React.FC<{
  githubConnected: boolean;
  onConnectGitHub: () => void;
  c: ReturnType<typeof useClaudeTokens>;
}> = ({ githubConnected, onConnectGitHub, c }) => (
  <Box sx={{ p: 2, mb: 2, borderRadius: `${c.radius.lg}px`, border: `1px solid ${c.border.subtle}`, bgcolor: c.bg.surface }}>
    <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: c.text.primary, mb: 1 }}>Connected Services</Typography>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* Google - coming soon */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, borderRadius: `${c.radius.md}px`, bgcolor: c.bg.secondary }}>
        <Typography sx={{ fontSize: '0.75rem', color: c.text.primary }}>Google</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: c.text.muted, fontStyle: 'italic' }}>Coming soon</Typography>
      </Box>

      {/* GitHub - live */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, borderRadius: `${c.radius.md}px`, bgcolor: c.bg.secondary }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <GitHubIcon />
          <Typography sx={{ fontSize: '0.75rem', color: c.text.primary }}>GitHub</Typography>
        </Box>
        {githubConnected ? (
          <Typography sx={{ fontSize: '0.7rem', color: c.status.success ?? c.accent.primary, fontWeight: 600 }}>Connected</Typography>
        ) : (
          <Button
            size="small"
            variant="outlined"
            onClick={onConnectGitHub}
            sx={{
              textTransform: 'none',
              fontSize: '0.7rem',
              py: 0.25,
              px: 1,
              minWidth: 0,
              borderColor: c.border.medium,
              color: c.text.primary,
              '&:hover': { borderColor: c.accent.primary, color: c.accent.primary, bgcolor: 'transparent' },
            }}
          >
            Connect
          </Button>
        )}
      </Box>
    </Box>
  </Box>
);

export default ConnectedServices;
