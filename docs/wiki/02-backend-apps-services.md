# Backend SubApps & Services

FastAPI orchestrator (`backend/main.py`, uvicorn `:8324`). Every feature is a
`SubApp` (`backend/config/Apps.py:12`): a `name`, an async `lifespan`
contextmanager, and an `APIRouter` mounted under `/api/{name}` with the lifespans
chained through an `AsyncExitStack` (`backend/config/Apps.py:25-46`).

Registration order in `backend/main.py:51`:
`MainApp([health, agents, skills, tools_lib, modes, settings, mcp_registry, skill_registry, outputs, dashboards, service, subscription, auth, web, anthropic_proxy])`.

On-disk roots resolve in `backend/config/paths.py`: dev → `backend/data/`,
packaged (`FREESWARM_PACKAGED=1`) → platform app-support (`paths.py:8-19`). Most
SubApps persist one JSON file per record via `backend/config/json_store.py`
(`read_json_or_none` / `atomic_write_json`).

---

## 1. `outputs` (Apps / Views) — `/api/outputs`

The largest SubApp: it is the "Apps"/"Views" feature (the App Builder mode writes
self-contained web apps into a workspace folder; the runtime serves and executes
them). SubApp object at `backend/apps/outputs/outputs.py:67`.

### Responsibility
- CRUD over saved **Output** records (a thin pointer: name/icon/schema + linkage
  to a workspace folder; `models.py:7-55`).
- Serve workspace/output files into the iframe preview, injecting data + auth
  token.
- Run a persistent per-workspace dev runtime (`bash run.sh` Vite, or legacy
  `python backend.py`) with log streaming.
- Execute user-supplied Python "backend code" in a sandboxed subprocess with an
  HITL warning gate.

### Data models (`outputs/models.py`)
- `Output` (`models.py:7`): `id`, `name`, `description`, `icon`, `input_schema`
  (JSON-Schema), `files: dict[str,str]`, `thumbnail`, `preview_updated_at`
  (only bumped on real screenshot save so opening an app doesn't reshuffle the
  grid; `models.py:19`), `session_id`/`workspace_id` linkage (`models.py:21-25`),
  timestamps. `_migrate_flat_fields` validator folds legacy `frontend_code`/
  `backend_code` into `files` (`models.py:29-47`); `frontend_code`/`backend_code`
  are read-only properties mapping to `files["index.html"]`/`files["backend.py"]`
  (`models.py:49-55`).
- `OutputCreate` / `OutputUpdate` (same migration validator).
- `OutputExecute` (`models.py:123`): `output_id`, `input_data`, `force` (HITL
  override; explicitly a UX gate not a security one — `models.py:127-133`).
- `OutputExecuteResult` (`models.py:136`): result + `stdout`/`stderr`/`error` +
  `warnings`/`code_preview` (populated when AST flags risk and `force` is unset).
- `WorkspaceSeedRequest` (`models.py:152`): `workspace_id`, `files`, `meta`,
  `template_mode: "flat" | "webapp_template"` (default `webapp_template`;
  `models.py:165`).
- `VibeCodeRequest` (`models.py:193`): used only by the dead `/vibe-code` endpoint
  (see Incomplete).

### On-disk storage layout
- `OUTPUTS_DIR` = `data/outputs/` — one `{output_id}.json` per Output
  (`workspace_io.py:32-40`, `paths.py:26`).
- `OUTPUTS_WORKSPACE_DIR` = `data/outputs_workspace/` — one folder per
  `workspace_id` holding the actual app source (`paths.py:27`). New-mode folders
  contain the vendored React+Vite template (`run.sh`, `.env` with
  `FRONTEND_PORT`/`BACKEND_PORT`, `SKILL.md`, optional `meta.json`); flat-mode
  folders hold `index.html` + `meta.json` + `schema.json` (`VIEW_TEMPLATE_FILES`,
  `view_builder_templates.py:157`).

### Key endpoints
- `GET /workspace/{ws}/serve/{filepath}` (`outputs.py:74`) — serves a workspace
  file. Path-traversal-confined with a trailing-`os.sep` check so a sibling
  prefix can't slip through (`outputs.py:80-85`). For `index.html` it injects
  `OUTPUT_INPUT`/`OUTPUT_BACKEND_RESULT`/`OUTPUT_BACKEND_URL` and re-stamps
  `?token=` onto relative URLs (`outputs.py:92-99`).
- `GET /{output_id}/serve/{filepath}` (`outputs.py:105`) — same, from a saved
  Output's `files` dict.
- `GET /list` (`outputs.py:127`), `GET /{output_id}` (`outputs.py:516`),
  `POST /create` (`outputs.py:521`), `PUT /{output_id}` (`outputs.py:539`,
  uses `exclude_unset` so an explicit `session_id=null` clears a stale link —
  see comment `outputs.py:542-547`), `DELETE /{output_id}` (`outputs.py:557`).
- `GET /workspace/{ws}` (`outputs.py:132`) — walks the folder via
  `_walk_directory` and returns `{files, meta, path}`.
- `POST /workspace/seed` (`outputs.py:253`) — creates/seeds a workspace. Two
  modes; `webapp_template` allocates a free `FRONTEND_PORT`, copies the React
  snapshot, writes `SKILL.md`, and registers an Output row at seed time so the
  app shows in the sidebar before autosave (`outputs.py:286-339`). Idempotent:
  skips the copy if `run.sh` already exists (`outputs.py:293-307`). A non-empty
  `files` payload forces `flat` mode (`outputs.py:282-284`).
- `PUT /workspace/{ws}/file/{filepath}` (`outputs.py:473`),
  `DELETE /workspace/{ws}/file/{filepath}` (`outputs.py:494`, prunes now-empty
  parent dirs).
- Runtime control: `POST /workspace/{ws}/runtime/start|stop|restart`
  (`outputs.py:425/435/442`), `GET .../runtime/status` (`outputs.py:457`),
  `POST /shutdown-all` (`outputs.py:462`, called by Electron pre-quit).
- `POST /execute` (`outputs.py:654`) — see sandbox flow below.
- `POST /vibe-code` (`outputs.py:566`) — **dead** (see Incomplete).
- WS `/ws/outputs/runtime/{ws}/logs` (`backend/main.py:283`) — streams the
  runtime ring buffer + live stdout/stderr to the Terminal pane; replays buffer
  on connect and emits a `runtime:status` frame.

Two non-route module helpers are imported by `agent_manager`:
`ensure_webapp_workspace_seeded_and_registered` (`outputs.py:195`, called from
`agent_manager.py:258-261` on the canvas-chat launch path) and
`sync_output_from_meta_json` (`outputs.py:154`, called from
`agent_manager.py:3167-3168` to sync the Output name/description from
`meta.json`, only overwriting placeholders).

### Sandboxed execution + HITL warnings flow (`/execute`)
`execute_output` (`outputs.py:654`):
1. Validate `input_data` against the Output's JSON Schema
   (`_validate_against_schema`, `html_inject.py:47`); return early on error.
2. If `backend_code` exists and `force` is False: call
   `get_code_warnings(code)` (`executor.py:42`). If any warnings, return them +
   `code_preview` and spawn **no** subprocess (`outputs.py:682-685`). The UI shows
   the preview dialog; "Run Anyway" re-POSTs with `force=True`.
3. Otherwise call `execute_backend_code(..., skip_validation=True)`
   (`outputs.py:686-694`) — `skip_validation` is safe here because warnings were
   already vetted or the user opted in.

`get_code_warnings` (`executor.py:42`) AST-walks the code and flags: imports
outside `_ALLOWED_MODULES` (data-shaping libs only; `executor.py:20-26`), and
direct calls to `_BLOCKED_BUILTINS` (`exec`/`eval`/`open`/`__import__`/… ;
`executor.py:32-35`). Syntax errors come back as a single warning, not a raise.

`execute_backend_code` (`executor.py:172`) — defense in depth (`executor.py:181`):
1. AST allowlist (`_validate_code_safety`, skipped when `skip_validation=True`).
2. Subprocess `cwd` = fresh `TemporaryDirectory` (`executor.py:225`).
3. Minimal env via `_minimal_env(force)` (`executor.py:119`): strict mode hands
   language-essentials only; force mode inherits real env **minus**
   `_SCRUBBED_ENV_KEYS` (auth token, all provider/cloud keys; `executor.py:102-116`).
   Both modes scrub the secrets.
4. A preamble `delattr`s dangerous builtins off `builtins` inside the child
   (`__import__` deliberately kept or all imports break; `executor.py:197-218`).
5. 30s wall-clock timeout (`TIMEOUT_SECONDS`, `executor.py:12`), killed on
   overrun (`executor.py:240-243`).
Code reads `input_data` from stdin (JSON), assigns global `result`; stdout is
captured separately via a `StringIO` redirect and returned as `__stdout__`.

### HTML injection / token rewrite (`html_inject.py`)
- `_inject_data_into_html` (`html_inject.py:84`) inserts a `<script>` setting
  `window.OUTPUT_INPUT`/`OUTPUT_BACKEND_RESULT`/`OUTPUT_BACKEND_URL` and a
  `postMessage` listener (`_build_data_injection`, `html_inject.py:57`).
- `_inject_token_into_relative_urls` (`html_inject.py:122`) — **security
  boundary**: iframe sub-resource fetches drop the parent `?token=` query, so the
  serve routes re-stamp it onto every relative `href`/`src`; absolute/CDN/`data:`/
  `#` URLs are skipped (`_ABSOLUTE_URL_PREFIXES`, `html_inject.py:111`). Idempotent.
- `_backend_url_for_workspace` (`html_inject.py:93`) returns the live runtime
  port URL or `"null"`.
- `_decode_data_param` (`html_inject.py:154`) decodes the base64 `_d` query param.

### Workspace I/O (`workspace_io.py`)
`_walk_directory` (`workspace_io.py:81`) returns `{rel_path: content}` skipping
build/install dirs (`_WALK_SKIP_DIRS`: `node_modules`, `.venv`, `__pycache__`,
`dist`, `.git`, … `workspace_io.py:57-71`) by mutating `dirs` in place, and
truncating files over 256 KB (`_WALK_MAX_FILE_BYTES`, `workspace_io.py:78`).
Critical because the read endpoint is polled every ~2s while the agent edits.
Paths normalized to forward slashes for Windows parity (`workspace_io.py:104`).

### Workspace runtime manager (`runtime.py` + `runtime_proc.py`)
`AppRuntimeManager` singleton `manager` (`runtime.py:497,679`). One `AppRuntime`
per workspace, reference-counted by subscriber.

`AppRuntime` (`runtime.py:62`):
- **Mode detection** via `_is_new_mode` = presence of `run.sh`
  (`runtime_proc.py:213`). New-mode → `bash run.sh` (Vite + optional FastAPI,
  reads ports from `.env`; `_start_new_mode`, `runtime.py:193`). Old-mode → `python
  -u backend.py` with `PORT` env (`_start_old_mode`, `runtime.py:358`).
- New-mode spawns are serialized through module-level `_vite_boot_lock`
  (`runtime.py:50,179`) so a burst of app creates doesn't run N parallel
  `optimizeDeps`; the lock is released by the bind-poller the instant Vite binds
  (`_await_frontend_bind`, `runtime.py:280-356`).
- Port-collision safety net: if a persisted `.env` port is held by a ghost from a
  prior session it's reallocated and `.env` rewritten (`runtime.py:209-234`,
  `_is_port_free`/`_write_env_value` in `runtime_proc.py`).
- `frontend_url` only returns a URL when `frontend_port && _frontend_ready &&
  running && not _suspended` (`runtime.py:129-142`) so the preview never points at
  an unbound/dead/frozen port.
- `recent_errors` deque scrapes stderr/stdout for build-error patterns
  (`_ERROR_PATTERNS`, `runtime_proc.py:34-49`); drained by the agent post-tool
  hook (`drain_errors`, `runtime.py:108`; `manager.drain_errors_for_path`,
  `runtime.py:615`) so the agent self-fixes vite/babel/uvicorn errors.
- `stop()` (`runtime.py:404`) kills the descendant tree first
  (`_kill_descendant_tree`, `runtime_proc.py:125`) because the template `run.sh`
  only traps `EXIT` not `TERM`, so a flat SIGTERM would orphan vite/uvicorn.

`AppRuntimeManager`:
- `attach` (`runtime.py:517`) — first attach spawns; revives an idle-pool entry
  (SIGCONT) instead of respawning.
- `detach` (`runtime.py:563`) — final detach moves the runtime to an LRU idle
  pool and SIGSTOPs the process tree (0% CPU while idle;
  `_suspend_process_tree`, `runtime_proc.py:52`). Pool capped at
  `_MAX_IDLE_RUNTIMES=3` (`runtime_proc.py:28`); oldest reaped on overflow.
- `stop_all` (`runtime.py:650`) — reaps active + idle (waking SIGSTOP'd ones
  first); parallel via `gather`. Idempotent.

### Lifespan (`outputs_lifespan`, `outputs.py:47`)
Startup: `makedirs` for `OUTPUTS_DIR` + `OUTPUTS_WORKSPACE_DIR`. Shutdown:
`runtime_manager.stop_all()` to reap every `bash run.sh` descendant tree;
without it they reparent to PID 1 and squat on `.env`-pinned ports, blocking the
next launch's reload (`outputs.py:53-64`).

---

## 2. `service` — `/api/service`

Replaces the former analytics SubApp (`service.py:1-12`). SubApp at
`service.py:242`.

### Responsibility
Usage/cost endpoints for the Settings page; background heartbeat ("pulse") to the
cloud for billing reconciliation; 9Router auto-start; frontend event ingestion;
offline spool drain.

### Key endpoints
- `GET /usage-summary` (`service.py:263`) — aggregates every session JSON (read
  off the event loop via `asyncio.to_thread`, `service.py:269`) plus live
  in-memory sessions; filters "real" sessions (`_is_real`, `service.py:273-281`);
  merges 9Router cost when available (`service.py:338-348`).
- `GET /cost-breakdown?period=7d` (`service.py:397`) — 9Router stats by
  model/provider.
- `GET /status` (`service.py:417`).
- `POST /submit` (`service.py:426`) — accepts three body shapes (flat
  `report()` `{s,a,p}`, legacy `{kind,payload}`, batched array;
  `service.py:428-446`). Pre-fix it silently dropped shape #1.
- `POST /event` (`service.py:477`) — normalizes `surface`/`action` (+ legacy
  dotted `event_type`) and forwards.
- `GET /spool/count` (`service.py:498`).

### Cloud forwarder (`client.py`)
Single entry `sync(data)` (`client.py:286`) — fire-and-forget, never raises;
stamps an `_envelope()` with install/user id, OS, timezone, locale, app version
(`client.py:138-187`); adds per-call `submission_id` UUID used as a cloud
idempotency key (`client.py:297-308`). Honors opt-out via
`_is_enabled`/`analytics_enabled()` (`client.py:115-135`). Failed/`429`/`5xx`
deliveries spool; non-retryable 4xx are dropped (`_retryable`, `client.py:216`;
`_post_or_spool`, `client.py:220`). `_MAX_INFLIGHT=16` (`client.py:46`); overflow
spools immediately. Legacy shims (`submit_event`, `submit_state`, `record`,
`identify`, …) at `client.py:357-417` keep ~50 call sites working.

### Storage
- Spool: bounded SQLite at `SETTINGS_DIR/service_spool.db` (`client.py:56-61`),
  single table `spool`, capped 50 MB, oldest trimmed at 75% on overflow
  (`buffer.py:29-96`). API: `enqueue`/`drain`/`acknowledge`/`count`/`clear`.
- Ring buffer: in-memory 50-entry deque for diagnostics (`ring_buffer.py`).
- `models.py` is intentionally empty — payloads are opaque dicts (`models.py:1`).
- App version resolved env-first (`FREESWARM_APP_VERSION`) with a
  `package.json` fallback that fails in packaged builds (`version.py:11-35`).

### Lifespan (`service_lifespan`, `service.py:122`)
Startup: stamps first-open + identity to cloud; boots 9Router in the
**background** (`_boot_9router_bg`, `service.py:203-210`) — awaiting it froze the
HTTP bind and the Electron splash timed out; starts `_pulse_loop` (60s sample,
batched every 10; `service.py:60`) and `_drain_loop` (60s spool drain;
`service.py:113`). Shutdown: cancels both tasks and stops 9Router.

---

## 3. `subscription` — `/api/subscription`

SubApp at `router.py:27`; trivial no-op lifespan (`router.py:22-24`). Desktop side
of FreeSwarm Pro (Stripe via the cloud router) + the zero-config free trial.

### Key endpoints
- `POST /activate` (`router.py:111`) — validates a bearer against cloud
  `/api/me`, persists `connection_mode="freeswarm-pro"` + plan/expires to
  settings.
- `GET /status` (`router.py:178`) — live `/api/me` poll; on cloud `401`/`402`
  calls `_clear_subscription` and reverts to `own_key` (`router.py:222-229`).
- `POST /sync` (`router.py:245`) — once-per-launch Stripe reconcile; same
  401/402 handling.
- `POST /portal` (`router.py:326`) — returns Stripe Customer Portal URL.
- `POST /disconnect` (`router.py:370`) — reverts to `own_key` but keeps the
  bearer (`drop_bearer=False`) so the account stays signed in
  (`_clear_subscription`, `router.py:50-71`).
- `POST /free-trial/mint` (`router.py:350`) → `arm_free_trial`;
  `POST /free-trial/status` (`router.py:359`) → `refresh_free_trial`.

### Free trial (`free_trial.py`)
Server-funded runs for an unconnected user. Identity is a salted SHA-256 of a
stable hardware id (`_FP_SALT`, `_raw_hardware_id`, `_fingerprint`;
`free_trial.py:29-78`) so reinstalling doesn't reset the count. `arm_free_trial`
(`free_trial.py:146`) guards against shadowing a real key/subscription
(`_has_own_model`, `_has_connected_subscription`; `free_trial.py:81-121`), pins
the trial to Haiku (`default_model="haiku"`, `free_trial.py:190-194`) because a
reasoning-tier pick makes the Claude Code CLI attach an `effort` param Haiku
400s on. Default ON, gated by `FREESWARM_FREE_TRIAL_ENABLED`
(`free_trial.py:32-38`).

### Storage
No own files; mutates the shared settings record (plan/expires/bearer/
`free_trial_*`).

---

## 4. `tools_lib` — `/api/tools`

SubApp `tools_lib` named `"tools"` (`tools_lib.py:54`). User-defined MCP tool
connectors, built-in tool permission policies, OAuth flows.

### Data models (`tools_lib/models.py`)
- `BuiltinTool` + `BUILTIN_TOOLS` list (`models.py:6-59`) — the canonical
  built-in tool catalog (Read/Edit/Write/Bash/Glob/Grep/AskUserQuestion core;
  Web*/Cron*/Browser*/Agent deferred or categorized).
- `ToolDefinition` (`models.py:62`) — `id`, `name`, `mcp_config`, `credentials`,
  `auth_type`/`auth_status`, `oauth_tokens`, `tool_permissions`,
  `connected_account_email`, `enabled`. `extra: "ignore"`.
- `ToolCreate`/`ToolUpdate`.

### Storage
- `TOOLS_DIR` = `data/tools/` — one `{tool_id}.json` per tool (`tools_lib.py:160`).
  `_load_all` is stat-signature cached (~1.5 MB total, hit on every dispatch;
  `tools_lib.py:120-157`).
- `BUILTIN_PERMISSIONS_PATH` = `data/builtin_permissions.json`
  (`load/save_builtin_permissions`, `tools_lib.py:194-204`).
- `TRUSTED_SENSITIVE_PATHS_PATH` = `data/trusted_sensitive_paths.json`
  (`tools_lib.py:207-228`).

### Key endpoints
- `GET /builtin` (`tools_lib.py:189`), `GET|PUT /builtin/permissions`
  (`tools_lib.py:231,252`; valid policies `always_allow`/`ask`/`deny`).
- `GET|PUT /trusted-sensitive-paths` (`tools_lib.py:236,242`).
- `GET /list` (`tools_lib.py:264`), `GET /{tool_id}` (`tools_lib.py:291`),
  `POST /create` (`tools_lib.py:296`), `PUT /{tool_id}` (`tools_lib.py:311`),
  `DELETE /{tool_id}` (`tools_lib.py:320`).
- `POST /{tool_id}/discover` (`tools_lib.py:328`) — refreshes OAuth if needed,
  derives the MCP config, connects (stdio/http/sse with HTTP→SSE fallback;
  `tools_lib.py:354-385`), classifies tools into services/groups, persists
  permissions + descriptions/schemas.
- M365 device-code login: `POST /{tool_id}/m365/device-login`
  (`tools_lib.py:409`), `GET .../status` (`tools_lib.py:515`),
  `POST .../disconnect` (`tools_lib.py:541`). Login runs as a backend
  subprocess scraping MSAL device-code output (`tools_lib.py:455-497`).
- OAuth: `POST /{tool_id}/oauth/start` (`tools_lib.py:580`, proxies through Fly so
  client secrets stay server-side), `GET /oauth/cloud-claim` (`tools_lib.py:606`,
  browser callback exchanging a single-use `session_id`),
  `POST /{tool_id}/oauth/disconnect` (`tools_lib.py:555`),
  `POST /google-oauth-token` (`tools_lib.py:674`, local mimic of Google's token
  endpoint forwarding refresh to the cloud pool).

Re-exports (`tools_lib.py:18-38`): `derive_mcp_config`, `_sanitize_server_name`
(consumed by `agent_manager`/`main`), and the `refresh_*` token helpers. Helper
modules: `mcp_config.py`, `mcp_discovery.py`, `tool_taxonomy.py`,
`oauth_config.py`, `oauth_tokens.py`.

### Lifespan (`tools_lib_lifespan`, `tools_lib.py:43`)
`makedirs(TOOLS_DIR)`; `_ensure_default_permissions` (seeds policies, Bash→`ask`,
all else→`always_allow`; `tools_lib.py:61-79`); fires a background one-time
`_reclassify_existing_tools` migration so it doesn't delay the HTTP bind
(`tools_lib.py:48-50,82`).

---

## 5. `modes` — `/api/modes`

SubApp at `modes.py:37`. Agent personas (system prompt + allowed tool subset).

### Data model (`modes/models.py`)
`Mode` (`models.py:8`): `id`, `name`, `system_prompt`, `tools` (None = all),
`default_next_mode`, `is_builtin`, `icon`/`color`, `default_folder`.
`BUILTIN_MODES` (`models.py:43`): **agent**, **ask** (read-only tool subset,
`models.py:69`), **plan**, **view-builder** ("App Builder", `default_folder` =
`OUTPUTS_WORKSPACE`, `models.py:116`), **skill-builder** (`default_folder` =
`SKILLS_WORKSPACE`, `models.py:178`).

### Storage
`MODES_DIR` = `data/modes/` — `{mode_id}.json` (`modes.py:56-64`).

### Key endpoints
`GET /list` (returns user modes + `builtin_defaults`, `modes.py:73`),
`GET /{id}` (`modes.py:79`), `POST /create` (`modes.py:84`), `PUT /{id}`
(`modes.py:101`), `POST /{id}/reset` (built-ins only, `modes.py:110`),
`DELETE /{id}` (refuses built-ins with 403, `modes.py:120`). Public helper
`load_mode` (`modes.py:67`).

### Lifespan (`modes_lifespan`, `modes.py:15`)
Migration that drops the deprecated built-in `chat.json` (merged into Ask) while
preserving customized copies (`modes.py:18-29`); writes any missing
`BUILTIN_MODES` to disk (`modes.py:30-33`).

---

## 6. `dashboards` — `/api/dashboards`

SubApp at `dashboards.py:112`. The canvas: positioned session/view/browser cards
+ notes.

### Data models (`dashboards/models.py`)
`Dashboard` (`models.py:66`): `id`, `name`, `auto_named`, timestamps,
`layout: DashboardLayout`, `thumbnail`, `preview_updated_at`,
`preview_signature`. `DashboardLayout` (`models.py:55`, `extra="allow"`) holds
`cards`/`view_cards`/`browser_cards`/`notes` dicts + `expanded_session_ids`.
Position types: `CardPosition`, `ViewCardPosition`, `BrowserCardPosition` (carries
`tabs`, `spawned_by`), `NotePosition`.

### Storage
`DASHBOARDS_DIR` = `data/dashboards/` — `{id}.json` (`dashboards.py:46-55`).
Sessions are tagged with `dashboard_id` and live in `SESSIONS_DIR`.

### Key endpoints
`GET /list` (sorted by updated_at, returns thumbnails meta; `dashboards.py:115`),
`POST /create` (`dashboards.py:135`), `POST /{id}/seed-demo` (`dashboards.py:142`)
and `POST /{id}/seed-orchestration-demo` (`dashboards.py:208`) for onboarding,
`POST /{id}/generate-name` (aux-LLM 2-4 word label, hardened against the model
answering the tasks; `dashboards.py:299`), `GET/PUT/DELETE /{id}`
(`dashboards.py:366/372/391`; DELETE cascades to session files + active
sessions), `POST /{id}/duplicate` (`dashboards.py:423`, remaps
session/browser ids across the cloned layout).

### Lifespan (`dashboards_lifespan`, `dashboards.py:105`)
`makedirs` + one-time `migrate_if_needed` (`dashboards.py:64`) that creates the
default dashboard from a legacy `dashboard_layout/layout.json` and tags existing
sessions with its id.

---

## 7. `skills` — `/api/skills`

SubApp at `skills.py:122`. SKILL.md authoring + the Skill Builder workspace.

### Data model (`skills/models.py`)
`Skill` (`models.py:6`): `id`, `name`, `description`, `content`, `file_path`,
`command`, `built_in`. `SkillCreate`/`SkillUpdate`/`SkillWorkspaceSeedRequest`.

### Storage (note: NOT under DATA_ROOT)
- Skills live in `~/.claude/skills/*.md` with metadata in
  `~/.claude/skills/.skills_index.json` (`skills.py:12-13`).
- Skill Builder workspaces under `SKILLS_WORKSPACE_DIR` =
  `data/skills_workspace/` (`skills.py:15`).

### Key endpoints
`GET /list` (`skills.py:153`), `GET /{id}` (`skills.py:219`), `POST /create`
(`skills.py:227`), `PUT /{id}` (`skills.py:255`), `DELETE /{id}`
(`skills.py:290`; refuses `built_in` skills with 409). Workspace:
`POST /workspace/seed` (`skills.py:174`), `GET /workspace/{id}` (returns
content + parsed YAML frontmatter, `skills.py:189`).

### Lifespan (`skills_lifespan`, `skills.py:109`)
`makedirs` both dirs; `_seed_built_in_skills` (`skills.py:72`) idempotently copies
the two shipped built-ins (`app_builder_skill`, `swarm_debug_skill`; sources at
`outputs/view_builder_templates.py:56,61`) into `~/.claude/skills/` and flags them
`built_in` in the index without overwriting user edits.

---

## Gotchas & invariants

- **Bearer token before HTTP bind**: `auth.py` generates the per-install token
  before binding so the Electron shell can read it from disk; don't reorder
  (`backend/CLAUDE.md:25,47`).
- **Iframe sub-resource auth**: any new outputs serve path MUST run
  `_inject_token_into_relative_urls` or sub-resources 401
  (`html_inject.py:1-6,122`).
- **Path traversal**: the outputs serve/write/delete routes check
  `startswith(folder + os.sep)`, not a bare prefix, so a sibling like
  `abc-secrets` can't slip past workspace `abc` (`outputs.py:80-85,486`).
- **`force` is a UX gate, not security**: anyone with the auth token can set
  `force=True`; the real boundary is the AST allowlist + scrubbed env + temp cwd +
  builtins scrub + 30s timeout (`models.py:127-133`, `executor.py:181`).
- **`__import__` is never scrubbed** in the executor preamble or every import
  breaks (`executor.py:200-208`).
- **`exclude_unset` on Output PUT**: an explicit `session_id=null` must clear the
  field; `exclude_none` silently dropped it and left a dead pointer that 404'd
  forever (`outputs.py:542-547`).
- **`preview_updated_at` sort key** moves only on a real thumbnail write, not on
  file/layout saves, so opening an app/dashboard doesn't reshuffle the grid
  (`models.py:19`, `outputs.py:550-552`, `dashboards.py:384`).
- **`_walk_directory` skip-list + 256 KB cap** is load-bearing: the read endpoint
  is polled every ~2s; without it the backend pegs CPU serializing
  `node_modules`/`.venv` (`workspace_io.py:49-78`).
- **9Router boots in the background** in both `service` and `settings` lifespans;
  awaiting it froze the HTTP bind and tripped the splash timeout
  (`service.py:194-210`).
- **Runtime port-collision recovery**: a persisted `.env` port held by a ghost is
  reallocated and `.env` rewritten before spawn (`runtime.py:209-234`).
- **`_vite_boot_lock` must be released exactly once** per spawn across success/
  death/timeout (`runtime.py:179-189`, `_await_frontend_bind` try/finally
  `runtime.py:296-356`).
- **`stop()` kills descendant tree first**: the template `run.sh` traps only
  `EXIT`, so a flat SIGTERM orphans vite/uvicorn (`runtime.py:413-417`,
  `runtime_proc.py:125`).
- **`stop_all` on shutdown is mandatory** (both lifespan + Electron pre-quit
  `/shutdown-all`) or `bash run.sh` descendants squat on `.env` ports and block
  the next launch (`outputs.py:53-64,462`).
- **`service` payloads are opaque**: the desktop has no schema knowledge; the
  cloud demuxes by shape (`client.py:1-18`, `models.py:1`).
- **Built-in skills/modes are editable but not deletable** (skills 409 at
  `skills.py:290-301`; modes 403 at `modes.py:123`).
- **Free trial must not count its own 9Router node** as a real connection or it
  self-clears on relaunch (`free_trial.py:111-119`).

## Incomplete / dead / TODO

- **`POST /api/outputs/vibe-code`** (`outputs.py:566`) and its `VibeCodeRequest`
  model (`models.py:193`) are **dead**: no frontend caller (`grep` of
  `frontend/src` for `vibe-code`/`vibeCode` returns nothing; the only references
  are the route + model themselves). The App Builder uses the agent/runtime flow
  instead. It still allocates an aux Sonnet model and would work if called.
- **`outputs.py` imports `MODEL_MAP`, `_resolve_model`, `_build_data_injection`**
  (`outputs.py:25-29`) that are **not used** anywhere in that file (`_resolve_model`
  and `load_output` are even listed in `linter/config/vulture_whitelist.py:52-53`
  as knowingly-unused). `MODEL_MAP`/`_resolve_model` (`html_inject.py:17-24`) are
  legacy hardcoded Claude model ids; the live path resolves via
  `providers.registry`. Safe to drop the imports.
- **Stray no-op `pass` statements** left after removed analytics calls:
  `outputs.py:535` (in `create_output`), `outputs.py:628` (in `vibe_code`),
  `skills.py:251` (in `create_skill`). Harmless, dead.
- **`client.submit(kind, payload)`** (`client.py:323`) is a thin compat shim that
  ignores `kind` and routes through `sync()`; the docstring says new call sites
  should use `sync()` directly. The whole legacy-shim block
  (`submit_event`/`submit_state`/`record`/`identify`/… `client.py:357-417`) is
  explicitly marked for removal once old import sites are migrated.
- **`version.py` packaged fallback** is effectively dead in shipped builds:
  `electron/package.json` isn't bundled into `Resources/`, so absent
  `FREESWARM_APP_VERSION` it returns `"unknown"` (`version.py:18-32`).
- **`service/models.py`** is a deliberate empty placeholder (`models.py:1`).
- **`tool_taxonomy._classify_services`** drives a one-time
  `_reclassify_existing_tools` migration (`tools_lib.py:82`) that becomes a no-op
  once all on-disk tools are reclassified; it re-runs (cheaply) every boot.
