# 03 - Backend Core & Security Posture

FastAPI orchestrator. Entry `backend/main.py`, binds `127.0.0.1:8324` (`main.py:837-838`),
REST `/api/*`, WS `/ws/*`, Swagger `/docs`. Every claim below is grounded in `file:line`.

---

## 1. HTTP / WS surface

App is assembled from a fixed ordered list of `SubApp`s, each mounted at `/api/<name>`
(`main.py:51-52`, routers mounted in `config/Apps.py:41-46`).

### Top-level routes declared in `main.py`

| Route | File:line | Notes |
|---|---|---|
| `WS /ws/agents/{session_id}` | `main.py:170` | per-session agent stream, resume + heartbeat |
| `WS /ws/outputs/runtime/{workspace_id}/logs` | `main.py:283` | runtime stdout/stderr tail |
| `WS /ws/dashboard` | `main.py:372` | global dashboard channel |
| `GET /api/dev/token` | `main.py:407` | dev-only token handoff; 404 when `FREESWARM_PACKAGED=1` (`main.py:412`) |
| `POST /api/browser/command` | `main.py:418` | browser-MCP subprocess -> WS bridge |
| `GET /api/subscriptions/pending/{state}` | `main.py:436` | 9Router callback page reads pending OAuth |
| `GET /api/subscriptions/callback` | `main.py:462` | OAuth redirect catcher (auth-exempt) |
| `POST /api/browser-agent/run` | `main.py:515` | browser sub-agents |
| `POST /api/mcp-meta/{action}` | `main.py:542` | list/search/activate MCP gate |
| `POST /api/agents/sessions/{id}/compact` | `main.py:744` | manual /compact |
| `POST /api/agents/sessions/{id}/clear` | `main.py:769` | /clear |
| `POST /api/invoke-agent/run` | `main.py:801` | fork+message a session |

SubApps (mounted `/api/<name>`): health, agents, skills, tools, modes, settings,
mcp-registry, skill-registry, outputs, dashboards, service, subscription, auth, web,
anthropic-proxy (`main.py:51`).

### Middleware chain (outermost -> innermost)

1. **CORSMiddleware** (`main.py:94-114`) - added first, so it wraps the auth middleware.
2. **`_auth_middleware`** (`main.py:117-168`) - the bearer-token gate; runs per request.

Starlette runs the last-added middleware outermost; `_auth_middleware` is added after
CORS, so the actual request order is auth-inside-CORS. Net effect: `OPTIONS` preflights
are short-circuited by the auth middleware itself (`main.py:137`) and CORS headers are
applied by the CORS layer.

### WS auth path

WS endpoints do not go through the HTTP middleware; each calls `_ws_auth_ok`
(`main.py:261-280`) which checks **both** token (`request_matches_token`) and Origin
(`is_origin_allowed`) before `accept()`. On failure it schedules `websocket.close(code=4401)`
via a task (can't await close before accept) and returns False (`main.py:276-279`).

---

## 2. Bearer-token auth model (`auth.py`)

- Per-install token, `secrets.token_urlsafe(32)` (`auth.py:48`), persisted to
  `AUTH_TOKEN_FILE` (`config/paths.py:34`) with atomic `0o600` write (`auth.py:16-29, 50`).
- Reused across restarts if present and 16..512 chars (`auth.py:36-44`) so Electron's
  cached copy stays valid.
- `request_matches_token` (`auth.py:227-255`) accepts the token via `Authorization: Bearer`,
  `x-freeswarm-token`, or `?token=` query param; compares with `secrets.compare_digest`
  (constant-time, `auth.py:253`). Fails closed when `_TOKEN` is empty (`auth.py:229-231`).
- The HTTP middleware additionally accepts `x-api-key` (`main.py:145, 150-153`) because the
  spawned Claude Code CLI is configured with `ANTHROPIC_API_KEY=<our_token>` and sends it as
  `x-api-key` on the non-exempt anthropic-proxy route (`main.py:130-134`).

### Why the token is generated BEFORE the HTTP bind

`init_auth_token()` is called at module import (`main.py:63`), which runs before uvicorn
binds the socket (`main.py:855-858`). The Electron shell reads the token file off disk to
authenticate its own requests; if the bind happened first, a request could land before the
file exists. This ordering is load-bearing in dev AND prod (`CLAUDE.md:25, 47`; comment
`main.py:54-55`). `install_token_scrubber()` is installed AFTER the token exists
(`main.py:64-67`) so any log line embedding the token gets redacted. The `installation_id`
is minted at the same pre-bind moment (`main.py:69-85`) so the very first `GET /api/settings`
already carries it for OAuth-URL construction.

---

## 3. SubApp lifespan boot sequence & non-blocking-boot invariant

`MainApp.lifespan` (`config/Apps.py:29-37`) enters each SubApp's lifespan **sequentially**
in list order via an `AsyncExitStack` (`config/Apps.py:31-34`), then prints the docs URL and
yields. List order (`main.py:51`):

```
health -> agents -> skills -> tools -> modes -> settings -> mcp-registry ->
skill-registry -> outputs -> dashboards -> service -> subscription -> auth -> web ->
anthropic-proxy
```

### Non-blocking-boot invariant

SubApp lifespans run sequentially *before uvicorn binds the socket*, so any slow await in a
lifespan delays `GET /api/health/check` and makes the Electron splash give up
(`apps/agents/agents.py:23-27`). Therefore expensive startup work must be deferred to a
background task, not awaited in the lifespan:

- **agents** (`apps/agents/agents.py:20-53`): spawns `_restore_bg()` as
  `asyncio.create_task` (`agents.py:37`) which runs `reconcile_on_startup()` then
  `restore_all_sessions()` (ordering matters: reconcile must finish before restore because
  restore deletes the files reconcile rewrites, `agents.py:26-36`). Shutdown cancels the task
  before persisting so the two don't race over session files (`agents.py:44-52`).
- **service** (`apps/service/service.py:123-...`): lifespan reads settings then starts
  `_pulse_task` / `_drain_task` background loops (module globals, `service.py:33-34, 124`).
- Most others (health, web, modes, anthropic-proxy, etc.) are trivial
  `yield`-only lifespans (e.g. `apps/health/health.py:8-12`,
  `apps/agents/proxy/anthropic_proxy.py:16-19`, `apps/web/web.py:24-28`).

`SubApp.__init__` only stores name/prefix/lifespan and builds an `APIRouter`
(`config/Apps.py:12-20`); no work happens at construction.

---

## 4. SECURITY POSTURE map (what is defended, and where)

### SSRF (`apps/agents/tools/ssrf_guard.py`)

- Async resolution via `loop.getaddrinfo`, non-blocking, covers IPv4 + IPv6
  (`ssrf_guard.py:53-60`).
- Rejects if **any** resolved record is private; multi-A defense against single-record
  rebinding (`ssrf_guard.py:104-106`, docstring `:80-83`).
- Blocked nets: RFC1918, `169.254/16` (cloud metadata), CGNAT `100.64/10`, multicast,
  `0.0.0.0/8`, benchmarking; v6 link-local/ULA/multicast/unspecified
  (`ssrf_guard.py:34-50`).
- Loopback (`127/8`, `::1`) is **intentionally allowed** (`ssrf_guard.py:69`, docstring
  `:7-11`) for App Builder localhost previews.
- Scheme restricted to http/https (`ssrf_guard.py:87-88`); unparseable IP -> block
  (`ssrf_guard.py:66-67`).
- `safe_fetch` walks redirects manually with `follow_redirects=False` and re-validates each
  hop (`ssrf_guard.py:128, 145`), and strips `authorization`/`cookie`/`proxy-authorization`
  on cross-host redirects (`ssrf_guard.py:31, 149-150`).
- Enforced at: `apps/web/web.py:523-525` (web fetch), `apps/agents/tools/web.py:218`
  (`WebFetchTool`), `apps/agents/agents.py:581-585` (custom-provider `/models` probe).

### Path traversal (`apps/outputs/outputs.py`)

- `serve_workspace_file` (`outputs.py:74-87`): normpaths both `workspace_id` and `filepath`,
  then requires `full_path` under `folder + os.sep` and `folder` under `base + os.sep`
  (trailing-sep check defeats the `abc` -> `abc-secrets` sibling-prefix bypass,
  `outputs.py:77-85`).
- Flat-seed write path applies a `startswith(folder)` guard before writing
  (`outputs.py:351-353`) - note: no trailing-sep here (see gaps).
- `serve_output_file` (`outputs.py:105-120`) serves from an in-memory `files` dict, no FS
  path involved.

### Token scrubbing (`auth.py:63-171`)

- `_TokenScrubFilter` redacts the live token from log records, fast-path pre-check avoids
  eager formatting (`auth.py:69-81, 111-114`); preserves tuple/dict arg shape so uvicorn's
  AccessFormatter doesn't explode (`auth.py:83-106`).
- `install_token_scrubber` attaches the filter to all existing handlers AND monkey-patches
  `Logger.addHandler` so handlers uvicorn adds later are covered (`auth.py:146-169`).
- Scrubber never suppresses a line; on its own exception it lets the record through
  (`auth.py:129-132`).

### CORS (`main.py:94-114`)

- Was previously `allow_origins=["*"]` + `allow_credentials=True` (a footgun,
  `main.py:88-93`). Now restricted to fixed Electron/cloud origins plus an `allow_origin_regex`
  for `file://` and `localhost`/`127.0.0.1` any-port (`main.py:96-102`).
- `max_age=600` caches preflights to cut the 1:1 OPTIONS:POST ratio (`main.py:106-113`).
- Treated as defense-in-depth; the token middleware is the primary defense
  (`main.py:90-93`).

### Reflected XSS in OAuth callbacks (`main.py:462-512`)

- `/api/subscriptions/callback` is auth-exempt and loadable in the localhost origin, so
  attacker-controlled query params are HTML-escaped before interpolation:
  `error_description`/`error` via `html.escape` (`main.py:478-485`), and the exchange
  exception message via `html.escape` (`main.py:501-508`).
- Idempotency: duplicate callbacks for an already-completed state return the success page
  instead of "Session expired" (`main.py:487-496`), tracked in `_completed_oauth`.

### Auth exemptions (`auth.py:174-213`)

Exact-match exempt set includes the OAuth/subscription callbacks, `/api/version`,
google-oauth-token proxy, dev token (`auth.py:175-192`); prefix-exempt: `/api/health`,
`/api/openai-passthrough`, `/docs`, `/openapi`, `/redoc`, `/favicon` (`auth.py:194-203`).
The anthropic-proxy route is deliberately NOT exempt (`main.py:130-134`).

---

## 5. Attack surface & gaps (ranked)

1. **No global request-body size cap.** Every `await request.json()` handler reads the full
   body with no size limit; relies on uvicorn/h11 defaults only. Largest exposure is the
   localhost-bound, but DoS via oversized JSON is unbounded. Examples:
   `main.py:423` (browser/command), `main.py:522` (browser-agent/run),
   `main.py:557` (mcp-meta), `main.py:805` (invoke-agent/run). No `MAX_BODY`/content-length
   guard found anywhere in `apps/` or `main.py`.
2. **Unvalidated `request.json()` bodies on raw routes.** The `main.py` raw routes parse JSON
   with `.get()` and no pydantic model / `@typechecked`, contrary to the CLAUDE.md guidance
   (`CLAUDE.md:52`). Fields are read untyped: `main.py:424-427` (browser/command),
   `main.py:523-527` (browser-agent/run), `main.py:557-558, 622, 655` (mcp-meta),
   `main.py:806-809` (invoke-agent/run). Validation is only presence checks (`main.py:428,
   529, 657-660, 811-814`). SubApps that DO use pydantic: e.g. `apps/web/web.py:40-56`.
3. **Flat-seed write-path traversal guard is weaker than the serve guard.**
   `outputs.py:352` uses bare `startswith(os.path.normpath(folder))` with **no trailing
   `os.sep`**, the exact sibling-prefix class the serve route was hardened against
   (`outputs.py:83-84`). A workspace whose normalized name is a prefix of a sibling could let
   a crafted `rel_path` escape. Lower severity (write requires the token + a chosen
   `workspace_id`) but inconsistent with the serve hardening.
4. **`is_origin_allowed` returns True for `origin is None`** (`auth.py:267-271`) and for any
   `http://localhost:*` / `http://127.0.0.1:*` / `file://` (`auth.py:272-278`). Intentional
   (native/MCP clients send no Origin; token still required) but means Origin is a weak
   second factor; the token is the only real gate on WS.
5. **`?token=` in query string** (`auth.py:247-249`, `main.py:148-149`) can leak via referrer
   / browser history / proxy logs. Needed for the App Builder `<iframe src>` case; the log
   scrubber mitigates server-side logging only.
6. **`/api/subscriptions/pending/{state}` returns `Access-Control-Allow-Origin: *`**
   (`main.py:442, 446`) and is reachable; it exposes `code_verifier` + `redirect_uri` for a
   known `state`. State is a secret nonce so practical risk is low, but it is a wildcard-CORS
   surface on an otherwise locked-down server.
7. **Resource leaks / unbounded growth.**
   - `_completed_oauth` is bounded by `_MAX_COMPLETED_OAUTH` (imported `main.py:24-29`) -
     good. `_pending_oauth` has no visible eviction in this file (entries only `pop`ped on
     callback, `main.py:487`); abandoned OAuth flows leak entries.
   - Runtime-log WS uses an unbounded `asyncio.Queue` (`main.py:320`); `put_nowait` swallows
     `QueueFull` (`main.py:322-326`) so it won't grow unboundedly, but a slow consumer drops
     log lines silently.
   - `_group_meta_inflight` dedup dict in `apps/agents/agents.py:16` - verify it is cleared
     on completion (not inspected here).

---

## 6. Gotchas & invariants

- **Pre-bind ordering is sacred:** `init_auth_token` -> `install_token_scrubber` ->
  `installation_id` all run at import, before bind (`main.py:63-85`). Don't reorder
  (`CLAUDE.md:25, 47`).
- **Scrubber after token, not before** (`main.py:64-67`); installing it before the token
  exists would no-op (`_TOKEN` empty -> `filter` returns early, `auth.py:109-110`).
- **WS disconnect does NOT cancel the agent task** (`main.py:256-259, 182-186`); only natural
  completion, `agent:stop`, REST `/close`, or shutdown end a run.
- **`_ws_auth_ok` must run before `accept()`** and before reading any data
  (`main.py:262-266, 188-190, 289-291`).
- **SSRF: never use `follow_redirects=True` on a user-supplied-URL fetch path**
  (`CLAUDE.md:60`, `ssrf_guard.py:122-123`). `apps/agents/tools/web.py:114` uses
  `follow_redirects=True` but only against the hardcoded DuckDuckGo endpoint, not a
  user URL.
- **MCP gate:** activation only via `/api/mcp-meta` with registry validation
  (`main.py:665-668`); unknown server names return options instead of activating
  (anti-hallucination). `session.active_mcps` defaults empty (`CLAUDE.md:29-32`).
- **Trailing-`os.sep` containment check** is the load-bearing detail in the serve guard
  (`outputs.py:78-79, 83-84`).
- **CORS added before auth middleware** so OPTIONS is handled correctly and CORS wraps auth
  (`main.py:94, 117`).

---

## 7. Incomplete / dead / TODO

- `main.py:694`: stray `pass  # MCP activation captured via session dump on close` - a
  no-op leftover after the broadcast block.
- `apps/outputs/outputs.py:352`: write-path traversal guard not updated to the trailing-sep
  form used by the serve route (`:83-84`); latent inconsistency (see gap #3).
- `main.py:407-415` (`/api/dev/token`): dev-only by design; 404s when packaged
  (`main.py:412`). Localhost binding is its only gate in dev (acknowledged, not a bug).
- `auth.py:108`: `# pragma: no cover (defensive)` - the scrubber `filter` is untested by
  design.
- No global body-size middleware exists despite multiple raw `request.json()` routes
  (gap #1); no TODO marker present, so it is an unflagged omission rather than tracked work.
