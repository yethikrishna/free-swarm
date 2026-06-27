# Breakthrough phases

Revolutionary/optimization features layered on top of F1-F13. The thesis:
**FreeSwarm is the runtime where agents are programs** (versioned, tested,
debugged, replayed, cost-governed), not disposable prompts.

Each shipped backend phase follows the same discipline as the automation
feature: a **leaf module** (pure, no agent-stack imports at load) with an
**injectable seam** the agent stack wires at boot, so the 2800-line
`agent_manager` is never destabilized. Backend phases are unit-tested; the two
frontend phases (P3/P7) are pure presentation over existing Redux/WS state and
are verified by `tsc` (the repo has no JS test runner).

## Shipped

| Phase | What | Where | Tests |
|---|---|---|---|
| P1 | Multi-agent coordination: capability registry, consensus gate, delegation queue, background dispatcher spawning workers via an injected launcher | `backend/apps/coordination/` + `/api/coordination/*` | `test_coordination.py` (12) |
| P2 | Adaptive tiered context compression: hot/warm/cold partition by token budget, importance weighting, summarize-at-boundary, cold-tier retrieval | `backend/apps/context/` + `/api/context/*` | `test_context.py` (9) |
| P3 | Live telemetry panel: cost + context/cache meters from the cost/context updates the WS already streams into Redux | `frontend/.../telemetry/SessionTelemetry.tsx` | typecheck |
| P4 | Approval gates + rewind: pure timeline (user turns -> rewind checkpoints) + declarative gate policy (gate/allow/deny by fnmatch + arg match); rewind driver reuses `edit_message`'s fork machinery | `backend/apps/rewind/` + `/api/rewind/*` | `test_rewind.py` (11) |
| P5 | Skill marketplace: publish/version/discover a versioned agent template (F10 manifest) with plan-gated install; cloud tables + endpoints, backend proxy + pure semver/manifest cores | `backend/apps/marketplace/` + `cloud/api/marketplace/*` | `test_marketplace.py` (10) |
| P7 | Chain-of-thought tree: pure `buildThoughtTree` derives turns -> steps (thinking/tool/response) from session messages; collapsible viz | `frontend/.../telemetry/ThoughtTree.tsx` | typecheck |
| P8 | Self-improving agent memory: per-agent-type playbook, lexical retrieval, heuristic reflection from finished runs | `backend/apps/memory/` + `/api/memory/*` | `test_memory.py` (8) |
| P9 | Deterministic record/replay: capture a session's non-deterministic edges, replay bit-for-bit, delta-compress, fork at a checkpoint | `backend/apps/replay/` + `/api/replay/*` | `test_replay.py` (8) |
| P10 | Per-turn predictive model routing: difficulty classifier + cheap->expensive ladder (from the registry, lane-aware) + daily budget governor | `backend/apps/routing/` + `/api/routing/*` | `test_routing.py` (16) |
| P12 | Agent-native testing/CI: regression suites over P9 replays. Pure assertion + diff + suite cores; runner reconstructs an outcome from a recorded log or reads the live session | `backend/apps/testing/` + `/api/testing/*` | `test_testing.py` (14) |

The backend phases are **advisory / opt-in by default**: they expose engines +
endpoints and (P1/P10/P4/P12) a launcher / `pick_for_turn` / runner / rewind
seam, but do not change existing
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
- **Leaf + seam (P1/P4/P12).** `coordination.py` never imports `agent_manager`;
  `coordination/launcher.py` wires the real worker spawner at boot, exactly like
  `automation/launcher.py`. Same for the routing/memory-reflect, rewind
  (`edit_message`), and testing (live-outcome resolver) seams.
- **P12 reuses P9; P4 reuses the fork machinery; P5 reuses F10.** Each new phase
  is built on an existing primitive rather than a parallel one: testing replays
  P9 logs, rewind drives `edit_message`, the marketplace publishes/install F10
  templates. No duplicated cores.
- **P3/P7 add zero data plumbing.** Both read the cost/context state the WS
  already streams into Redux and the messages already in the session; they are
  pure presentation (`buildThoughtTree` is the only logic, and it's pure).

## Deferred (and why)

Only the two genuine-infrastructure phases remain. They cannot live in a
serverless function or a desktop leaf module, so they are out of scope for this
code-level batch:

- **P6 Distributed runtime / cloud burst**: needs a persistent worker tier
  (queue + autoscaling compute), not a request-scoped function. P1's delegation
  queue is the in-process precursor; the distributed version is an ops project.
- **P11 Offline-first local model**: bundling + quantizing a local model into the
  desktop build is a packaging/infra effort (model weights, hardware detection,
  a local inference runtime), not application code.

Everything else from the roadmap (P1-P5, P7-P10, P12) is shipped above.

## Leftovers closed alongside

The three "not yet wired" items from F1-F13 are also done here, see
`FEATURES_F1_F13.md` ("Producers + delivery"): cost/audit producers (L1),
outbound webhook/notification delivery (L2), and the share-transcript button +
public viewer (L3).
