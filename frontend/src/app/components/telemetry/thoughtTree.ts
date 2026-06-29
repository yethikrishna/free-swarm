// P7 chain-of-thought derivation. Pure: turns a flat AgentMessage[] into a
// reasoning tree of turns -> steps (thinking / tool call / assistant text), so
// the UI can render a collapsible "how the agent got there" view without the
// component re-deriving structure on every paint. No React, no Redux.

import type { AgentMessage } from '@/shared/state/agentsSlice';

export type ThoughtStepKind = 'thinking' | 'tool' | 'text';

export interface ThoughtStep {
  id: string;
  kind: ThoughtStepKind;
  title: string;
  detail: string;
  tool?: string;
  elapsedMs?: number;
  status?: 'ok' | 'error';
}

export interface ThoughtTurn {
  id: string;
  prompt: string;
  steps: ThoughtStep[];
  toolCount: number;
}

function textOf(content: any): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function toolNameOf(content: any): string {
  if (content && typeof content === 'object') {
    for (const k of ['name', 'tool_name', 'tool']) {
      if (typeof content[k] === 'string') return content[k];
    }
  }
  return 'tool';
}

function isErrorResult(content: any): boolean {
  if (content && typeof content === 'object') {
    if (content.is_error === true || content.isError === true) return true;
  }
  return /\berror\b/i.test(textOf(content).slice(0, 80));
}

function clip(text: string, n = 280): string {
  const t = (text || '').trim();
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

function elapsedLabel(ms?: number): string {
  if (!ms || ms < 0) return 'Thought';
  if (ms < 1000) return 'Thought briefly';
  return `Thought for ${Math.round(ms / 1000)}s`;
}

// Build the tree. Each user message opens a new turn; thinking/assistant/tool
// activity attaches to the open turn. Tool results fold into the immediately
// preceding tool step (status only) rather than becoming their own node.
export function buildThoughtTree(messages: AgentMessage[]): ThoughtTurn[] {
  const turns: ThoughtTurn[] = [];

  // Always returns a turn to attach to: the open one, or a fresh anonymous turn
  // if activity arrives before any user message. Avoids a mutable closure var
  // that defeats TS control-flow narrowing.
  const ensureTurn = (id: string): ThoughtTurn => {
    if (!turns.length) turns.push({ id, prompt: '', steps: [], toolCount: 0 });
    return turns[turns.length - 1];
  };
  const openTurn = (prompt: string, id: string): ThoughtTurn => {
    const turn: ThoughtTurn = { id, prompt, steps: [], toolCount: 0 };
    turns.push(turn);
    return turn;
  };

  for (const m of messages || []) {
    if (m.hidden) continue;
    if (m.role === 'user') {
      openTurn(clip(textOf(m.content), 120), m.id);
    } else if (m.role === 'thinking') {
      ensureTurn(m.id).steps.push({
        id: m.id, kind: 'thinking',
        title: elapsedLabel(m.elapsed_ms), detail: clip(textOf(m.content)),
        elapsedMs: m.elapsed_ms,
      });
    } else if (m.role === 'tool_call') {
      const turn = ensureTurn(m.id);
      turn.steps.push({
        id: m.id, kind: 'tool',
        title: toolNameOf(m.content), tool: toolNameOf(m.content),
        detail: clip(textOf(m.content?.input ?? m.content)), status: 'ok',
      });
      turn.toolCount += 1;
    } else if (m.role === 'tool_result') {
      const turn = turns[turns.length - 1];
      const last = turn?.steps[turn.steps.length - 1];
      if (last && last.kind === 'tool') {
        last.status = isErrorResult(m.content) ? 'error' : 'ok';
        if (!last.detail) last.detail = clip(textOf(m.content));
      }
    } else if (m.role === 'assistant') {
      const body = textOf(m.content);
      if (body.trim()) {
        ensureTurn(m.id).steps.push({ id: m.id, kind: 'text', title: 'Response', detail: clip(body, 500) });
      }
    }
  }

  return turns.filter((t) => t.steps.length > 0);
}
