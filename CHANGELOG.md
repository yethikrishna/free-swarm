# FreeSwarm - Changelog

All notable changes to the FreeSwarm app (desktop + cloud) are documented here.
Router changes live in `CHANGELOG_ROUTER.md`.

## [Unreleased]

### ✨ Breakthrough phases

Revolutionary/optimization features layered on the F1-F13 platform. Each backend
phase is a **leaf module** (pure core, no agent-stack imports at load) wired by an
**injectable seam** at boot, so the 2800-line `agent_manager` is never
destabilized. See `docs/BREAKTHROUGH_PHASES.md` for the full design rationale.

#### Multi-agent coordination (P1)
- Capability registry + pure match scoring routes a subtask to the best-fit agent
- Consensus gate decides delegate-vs-attack-directly before splitting work
- Delegation blackboard (pending -> running -> done/failed) + background dispatcher
- Workers spawned through an injected launcher, never importing the agent stack
- `backend/apps/coordination/` + `/api/coordination/*`, 12 tests

#### Adaptive tiered context compression (P2)
- Hot/warm/cold partition by token budget with importance weighting
- Summarize-at-boundary (injectable summarizer) + cold-tier semantic retrieval
- `backend/apps/context/` + `/api/context/*`, 9 tests

#### Live telemetry panel (P3)
- Cost + context-window + cache-hit meters that update live from the cost/context
  events the WebSocket already streams into Redux
- `frontend/.../telemetry/SessionTelemetry.tsx`, behind the chat Insights toggle

#### Approval gates + rewind timeline (P4)
- Pure timeline maps user turns to rewind checkpoints (rewindable only on the
  active branch, mirroring `edit_message`)
- Declarative gate policy: gate/allow/deny per tool via ordered fnmatch + arg rules
- Rewind driver reuses the existing fork-and-rerun machinery
- `backend/apps/rewind/` + `/api/rewind/*`, 11 tests

#### Skill marketplace (P5)
- Publish / version / discover a versioned agent template (the F10 manifest)
- Plan-gated discovery + server-side install enforcement; download counter
- Cloud tables + `/api/marketplace/*`; backend proxy with pure semver + manifest
  cores; install drops a fetched skill into the local template library
- `backend/apps/marketplace/` + `cloud/api/marketplace/*`, 10 tests

#### Chain-of-thought visualization (P7)
- Pure `buildThoughtTree` derives turns -> steps (thinking / tool / response) from
  session messages; collapsible reasoning view
- `frontend/.../telemetry/ThoughtTree.tsx`, behind the chat Insights toggle

#### Self-improving agent memory (P8)
- Per-agent-type playbook, lexical retrieval, heuristic reflection from finished runs
- `backend/apps/memory/` + `/api/memory/*`, 8 tests

#### Deterministic record/replay (P9)
- Capture a session's non-deterministic edges, replay in order, delta-compress,
  fork at a checkpoint
- `backend/apps/replay/` + `/api/replay/*`, 8 tests

#### Per-turn predictive model routing (P10)
- Difficulty classifier + cheap->expensive ladder (built from the registry,
  provider/route-lane aware) + daily budget governor
- No hardcoded model ids; only relative tier order is encoded
- `backend/apps/routing/` + `/api/routing/*`, 16 tests

#### Agent-native testing/CI (P12)
- Regression suites over P9 replays: pure assertion + diff + suite cores
- Runner reconstructs an outcome from a recorded log, or reads the live session
- `backend/apps/testing/` + `/api/testing/*`, 14 tests

All backend phases are **advisory / opt-in by default**: they expose engines and
endpoints (and launcher / `pick_for_turn` / runner / rewind seams) without
changing existing turn behavior until enabled.

### ⚡ Live activation (Tier 0)
- The advisory engines now affect real runs, behind their own opt-in flags, via
  one defensive seam (`live_integration`) that never raises and no-ops when off:
  - **P10 routing** picks the per-turn model (no-op unless routing policy enabled)
  - **P4 gates** fold into per-tool permissions, tighten-only (no-op unless gate
    policy `enforce` is set; never loosens an existing permission)
- Off by default: an untouched install is byte-for-byte unchanged.

### 📊 Observability + evaluation (Tier 1)
- **Tracing** (`/api/tracing/*`): span timeline + hotspot ranking from the timings
  the loop already records; UI in the chat Insights panel
- **Benchmark** (`/api/benchmark/*`): grades a P12 suite run (pass rate, cost/turn
  efficiency, composite + letter grade) and A/B-compares two configs

### 🧱 Tier 2 (app-side built; infra boundary marked)
- **P6 worker placement** (`/api/cluster/*`): local-vs-burst placement by mode +
  live load; local runs today via P1, remote is an HTTP seam an operator deploys
- **P11 offline mode** (`/api/offline/*`): detect + select a user-run local
  OpenAI-compatible model (LM Studio/Ollama/llama.cpp/Jan); model bundling stays
  a packaging effort

### 🔒 Security
- Marketplace discovery projects to a public shape (no internal `owner_id` leak)
- Publish rejects manifests over 64KB to prevent storage abuse
- All marketplace SQL is parameterized; install/get/delete authorization re-checked

### 🧩 Producers + delivery (leftovers closed)
- **L1** cost/audit producers: fire-and-forget per-turn cost deltas + audit events
- **L2** outbound webhook (HMAC-signed) + Slack/email notification delivery
- **L3** share-transcript button in the chat header + public viewer page

### ⏭️ Remaining infrastructure (operator/packaging, not application code)
- **P6** the remote worker fleet the placement layer bursts to (provisioned compute)
- **P11** bundling + quantizing a model into the desktop build (packaging)

## [1.0.0] - June 2026

### ✨ Platform features (F1-F13)
Device/session management, teams & collaboration, session sharing & export,
advanced cost management, scheduled tasks & automation, activity & audit logs,
analytics dashboard, RBAC, API keys & webhooks, agent templates & presets, 2FA
+ session-timeout policy, custom branding, and notification integrations. See
`docs/FEATURES_F1_F13.md` for details.
