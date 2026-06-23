# 01 - Backend Agent Orchestration

Scope: `backend/apps/agents/` - the agent run loop, session lifecycle, model
routing, the MCP gate, aux-LLM usage, and the WebSocket event stream. Line
references are to `backend/apps/agents/agent_manager.py` unless noted.

> Status: assembled from a deep code read. Treat line numbers as accurate at the
> time of writing; re-grep if the file has shifted.

## Public / dispatch entry methods (AgentManager)

| Method | Line | Purpose |
|---|---|---|
| `__init__` | 132 | Construct manager, in-memory `self.sessions` dict |
| `launch_agent(config)` | 227 | Create + start a new session |
| `send_message(session_id, prompt, mode=None, ...)` | 3328 | Follow-up turn dispatcher |
| `stop_agent(session_id)` | 3604 | Cancel a running turn |
| `handle_approval(request_id, decision)` | 3642 | HITL approve/deny resolution |
| `edit_message(session_id, message_id, new_content)` | 3646 | Branch fork from an edit |
| `switch_branch(session_id, branch_id)` | 3732 | Activate a different branch |
| `generate_title(session_id, first_prompt)` | 3745 | Aux-LLM session title |
| `generate_turn_label(session_id, turn_id, user_prompt)` | 3825 | Aux-LLM per-turn label |
| `warm_prompt_cache(session_id)` | 3904 | Pre-warm prompt cache |
| `generate_group_meta(session_id, group_id, tool_calls, ...)` | 3951 | Aux-LLM tool-group name + icon |
| `update_session(session_id, **fields)` | 4050 | Patch session fields |
| `close_session(session_id)` | 4077 | Persist + close |
| `delete_session(session_id)` | 4133 | Remove session |
| `resume_session(session_id)` | 4157 | Reopen a closed session from disk |
| `get_history(q, limit, ...)` | 4196 | Search session history |
| `reconcile_on_startup()` | 4237 | Mark stale running->stopped, migrate chat->ask |
| `persist_all_sessions()` | 4258 | Flush all to disk |
| `restore_all_sessions()` | 4278 | Load all from disk on boot |
| `duplicate_session(session_id, dashboard_id=None, ...)` | 4305 | Deep copy with new UUIDs |
| `invoke_agent(source_session_id, message, ...)` | 4382 | Spawn an isolated sub-agent fork |
| `get_all_sessions(dashboard_id=None)` | 4499 | List sessions |
| `get_session(session_id)` | 4504 | Lookup |
| `get_browser_agent_children(parent_session_id)` | 4507 | Browser sub-agent listing |

## The run loop (`_run_agent_loop`, line 419)

1. Resolve the model id + API type early: `_resolve_model_id_early` (453) and
   `_get_api_type_early` (458) -> `anthropic | openai | gemini | custom | openrouter`.
2. Build `ClaudeAgentOptions` (instantiated at 1944): model, a `prompt_stream()`
   generator, thinking budget, `mcp_servers` from `_build_mcp_servers(...)` (1169),
   allowed/disallowed tools, the `can_use_tool` HITL approval hook, hooks, and a
   `stderr` callback (1475) that feeds error classification.
3. Iterate `async for message in query(prompt=prompt_stream(), options=options)`
   (2267). Handlers: `SystemMessage` (2328), `StreamEvent` (2332), `AssistantMessage`
   (2465), `ResultMessage` (2641, authoritative usage/cost + `sdk_session_id`).

### Connection-mode env wiring (inside the loop)
- Direct Anthropic key: `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL=api.anthropic.com` (1667).
- FreeSwarm Pro / free-trial proxy: `ANTHROPIC_AUTH_TOKEN` + proxy `ANTHROPIC_BASE_URL`
  (1639); free-trial adds `X-Openswarm-Task-Id` custom header (1662).
- OpenRouter: 9router on `:20128` with subagent model pins (1606).
- Custom OpenAI-compatible: `OPENAI_API_KEY` + normalized `OPENAI_BASE_URL` (1547).
- Direct Gemini (route=api): `GEMINI_API_KEY` + local anthropic-proxy base url (1593).
- Default 9router fallback: `ANTHROPIC_BASE_URL=localhost:20128` (1670).

## Session create / restore / reconcile
- `launch_agent` (227): applies context window (317), registers an Output row for
  `view-builder` mode (255-284), ensures a git repo (298), broadcasts `agent:status` (322).
- `resume_session` (4157): loads JSON, re-applies context window, clears `closed_at`,
  does NOT delete the disk file.
- `reconcile_on_startup` (4237): stale `running`/`waiting_approval` -> `stopped`;
  migrates legacy `mode="chat"` -> `"ask"`; rewrites disk. Idempotent.
- `restore_all_sessions` (4278): loads all JSON off-thread, skips closed/corrupt,
  resets running->stopped, clears pending approvals, deletes the disk file after load
  to avoid duplicates on next boot.

### Fork / fresh-session invariants
- `needs_fresh_session` (1837): drops `sdk_session_id`, replays local history to rebuild
  the SDK session. Set by `edit_message` (3690) and `switch_branch` (3739).
- `needs_fork` (1849): passes `fork_session=True` to options. Set on cross-provider model
  switch (3372), MCP trim (1940), and externally-disabled MCPs (1084).

## The MCP gate (`_build_mcp_servers`, line 139)
Sole control point for MCP reachability:
- `active_mcps=None` (legacy) -> all enabled MCPs shipped.
- `active_mcps=[]` -> zero MCPs.
- `active_mcps=[...]` -> only listed servers; others gated at 181 ("GATED {server}").
Sub-agents (`invoke_agent`) force `active_mcps=[]` for isolation (4382, see also 983).

## Aux-LLM usage (cheap tier of the user's provider)
`resolve_aux_model(..., primary_api=get_api_type(session.model))` is called at:
- title 3757 (`preferred_tier="haiku"`), turn-label 3849 (`haiku`), group-meta 3975 (`sonnet`).
Never hardcodes Haiku; picks the cheap tier of the configured provider.

## Token accounting, compaction, MCP LRU trim
- Usage parsed from `ResultMessage` (2673-2750): input = input + cache_create + cache_read.
- Cost (2752-2819): free routes (cc/cx/gc/ag/openrouter:free/cp-*, Pro/free-trial) -> 0.0;
  OpenRouter + direct OpenAI/Gemini priced from their tables.
- `_maybe_compact` (353): summarizes when `tokens.input / context_window >= compact_threshold`
  (default 0.65), keeps the last 6 messages, sets `compacted_through_msg_id`.
- Soft-cap MCP trim (1886): LRU-pops oldest `active_mcps` (~8000 tok each) while over the
  hard cap, keeps >=1, emits `agent:context_status`.

## WebSocket events (emitter -> meaning)
Status `agent:status`; messages `agent:message`; streaming `agent:stream_start/_delta/_end`;
context `agent:context_update` / `:context_status` / `:context_overflow`; errors
`agent:auth_error`, `agent:free_trial_exhausted`; lifecycle `agent:closed`,
`agent:name_updated`, `agent:turn_label`, `agent:branch_created`, `agent:branch_switched`,
`agent:group_meta_updated`; cost `agent:cost_update`; outputs `agent:output_upserted`.

## Error handling
- Stderr buffered (1473, max 500 lines) and fed to classifiers in `error_classify.py`.
- Transient-capacity retry loop (2848) with exponential backoff; resumes via
  `resume=sdk_session_id`.
- Classified paths: long-context (2968), free-trial exhausted (3012), auth (3035),
  unknown-model (3101), unclassified (3123) - each emits a friendly system message.

## Incomplete / dead / stub
- `_run_mock_agent` (3234): dev fallback when `claude_agent_sdk` is absent (442);
  tags `_mock_run=True` (3317) so mock turns never report to cloud. Keep (dev path).
- No TODO/FIXME/NotImplementedError found in the 2600-4526 range.
