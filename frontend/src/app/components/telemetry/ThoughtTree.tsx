// P7 chain-of-thought visualization. Renders the reasoning tree derived from a
// session's messages: turns -> steps (thinking / tool / response), each step
// expandable. Reads session.messages from Redux; structure comes from the pure
// buildThoughtTree so this stays presentation-only.

import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import PsychologyOutlinedIcon from '@mui/icons-material/PsychologyOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useAppSelector } from '@/shared/hooks';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import type { ClaudeTokens } from '@/shared/styles/claudeTokens';
import { buildThoughtTree, ThoughtStep } from './thoughtTree';

const StepIcon: React.FC<{ step: ThoughtStep; c: ClaudeTokens }> = ({ step, c }) => {
  const sx = { fontSize: 15, color: c.text.muted } as const;
  if (step.kind === 'thinking') return <PsychologyOutlinedIcon sx={sx} />;
  if (step.kind === 'text') return <ChatBubbleOutlineIcon sx={sx} />;
  if (step.status === 'error') return <ErrorOutlineIcon sx={{ fontSize: 15, color: '#b5483a' }} />;
  return <BuildOutlinedIcon sx={sx} />;
};

const StepRow: React.FC<{ step: ThoughtStep; c: ClaudeTokens }> = ({ step, c }) => {
  const [open, setOpen] = useState(false);
  const expandable = step.detail.length > 0;
  return (
    <Box sx={{ pl: 1.5, borderLeft: `2px solid ${c.border.medium}`, ml: 0.75, py: 0.4 }}>
      <Box
        onClick={() => expandable && setOpen((v) => !v)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          cursor: expandable ? 'pointer' : 'default',
          '&:hover': expandable ? { opacity: 0.85 } : {},
        }}
      >
        <StepIcon step={step} c={c} />
        <Typography sx={{ fontSize: 12.5, color: c.text.secondary, fontWeight: step.kind === 'tool' ? 500 : 400 }}>
          {step.title}
        </Typography>
      </Box>
      <Collapse in={open} timeout={180} unmountOnExit>
        <Typography sx={{
          fontSize: 12, color: c.text.muted, mt: 0.5, ml: 2.75, whiteSpace: 'pre-wrap',
          fontFamily: step.kind === 'tool' ? 'monospace' : 'inherit',
        }}>
          {step.detail}
        </Typography>
      </Collapse>
    </Box>
  );
};

export const ThoughtTree: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const c = useClaudeTokens();
  const messages = useAppSelector((s) => s.agents.sessions[sessionId]?.messages);
  const turns = useMemo(() => buildThoughtTree(messages || []), [messages]);

  if (!turns.length) {
    return (
      <Typography sx={{ fontSize: 12, color: c.text.muted, p: 1.5 }}>
        No reasoning steps yet.
      </Typography>
    );
  }

  return (
    <Box sx={{ p: 1 }}>
      {turns.map((turn) => (
        <Box key={turn.id} sx={{ mb: 1.5 }}>
          {turn.prompt && (
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: c.text.primary, mb: 0.5 }}>
              {turn.prompt}
            </Typography>
          )}
          {turn.steps.map((step) => <StepRow key={step.id} step={step} c={c} />)}
          {turn.toolCount > 0 && (
            <Typography sx={{ fontSize: 11, color: c.text.muted, mt: 0.5, ml: 2.25 }}>
              {turn.toolCount} {turn.toolCount === 1 ? 'tool used' : 'tools used'}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
};

export default ThoughtTree;
