# Breakthrough phases

Revolutionary/optimization features layered on top of F1-F13. The thesis:
**FreeSwarm is the runtime where agents are programs** (versioned, tested,
debugged, replayed, cost-governed), not disposable prompts.

Each shipped phase follows the same discipline as the automation feature: a
**leaf module** (pure, no agent-stack imports at load) with an **injectable
seam** the agent stack wires at boot, so the 2800-line `agent_manager` is never
destabilized. Every shipped phase is unit-tested.

## Shipped

| Phase | What | Where | Tests |
|---|---|---|---|
| P1 | Multi-agent coordination: capability registry, consensus gate, delegation queue, background dispatcher spawning workers via an injected launcher | `backend/apps/coordination/` + `/api/coordination/*` | `test_coordination.py` (12) |
| P2 | Adaptive tiered context compression: hot/warm/cold partition by token budget, importance weighting, summarize-at-boundary, cold-tier retrieval | `backend/apps/context/` + `/api/context/*` | `test_context.py` (9) |
| P8 | Self-improving agent memory: per-agent-type playbook, lexical retrieval, heuristic reflection from finished runs | `backend/apps/memory/` + `/api/memory/*` | `test_memory.py` (8) |
| P9 | Deterministic record/replay: capture a session's non-deterministic edges, replay bit-for-bit, delta-compress, fork at a checkpoint | `backend/apps/replay/` + `/api/replay/*` | `test_replay.py` (8) |
| P10 | Per-turn predictive model routing: difficulty classifier + cheap->expensive ladder (from the registry, lane-aware) + daily budget governor | `backend/apps/routing/` + `/api/routing/*` | `test_routing.py` (16) |

All five are **advisory / opt-in by default**: they expose engines + endpoints
and (for P1/P10) a `pick_for_turn` / launcher seam, but do not change existing
turn behavior until enabled. This is deliberate, the routing and compaction
paths are correctness-sensitive, so the engines ship proven and the wiring is a
one-line opt-in rather than a risky rewrite.

### Design notes

- **No hardcoded model ids (P10).** The ladder is built from the registry's
  `BUILTIN_MODELS` and restricted to the selected model's provider+route lane;
  only the relative tier order (haiku < sonnet < opus < fable; mini < full;
  flash < pro) is encoded, which is inherent product knowledge.
- **Pure cores everywhere.** Difficulty scoring, tier planning, importance,
  consensus, delta compression, and similarity are all pure functions, so the
  load-bearing logic is verifiable without the agent manager, a model, or I/O.
- **Leaf + seam (P1).** `coordination.py` never imports `agent_manager`;
  `coordination/launcher.py` wires the real worker spawner at boot, exactly like
  `automation/launcher.py`. Same for the routing/memory reflect seams.

## Deferred (and why)

These phases from the roadmap are not built here. They are larger surfaces that
the shipped foundations unblock, but each needs work outside a backend leaf
module:

- **P3 Live telemetry dashboard** and **P7 chain-of-thought visualization**:
  frontend-heavy (real-time charts, thought-tree UI). The data already streams
  over the session WebSocket (`agent:cost_update`, `agent:context_update`); the
  remaining work is React surfaces.
- **P4 Approval gates / rewind**: the approval loop already exists in
  `agent_manager` (HITL via `handle_approval`); "rewind to edit" overlaps the
  existing `edit_message`/branch machinery. This is UX consolidation, not new
  core.
- **P5 Skill marketplace**: cloud-heavy (publish/version/discover, billing tier
  gating). Builds on F10 templates + the cloud schema.
- **P6 Distributed runtime / cloud burst** and **P11 offline-first local model**:
  infrastructure (a persistent worker tier; bundling + quantizing a local model)
  that can't live in a serverless function or a desktop leaf module.
- **P12 Agent-native testing/CI**: the PR-watch plumbing already exists; the
  red-green-verify loop would extend it. P9's deterministic replay is the
  enabling primitive (reproducible runs = regression tests).

## Leftovers closed alongside

The three "not yet wired" items from F1-F13 are also done here, see
`FEATURES_F1_F13.md` ("Producers + delivery"): cost/audit producers (L1),
outbound webhook/notification delivery (L2), and the share-transcript button +
public viewer (L3).
