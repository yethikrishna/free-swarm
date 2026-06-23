# 07 - Cloud Service & 9Router Architecture

FreeSwarm has two distinct "remote brain" layers: a **stateless cloud service** (auth/billing/usage) and a **9Router** local AI gateway (provider routing). They are independent: the cloud service never runs inference; 9Router never touches billing. This section covers both, plus how the desktop app boots and supervises 9Router, how requests are routed, and the cloud↔local fallback ladder.

## 7.1 Cloud Service

### Purpose & boundary

The cloud service (`cloud/`) is a thin, stateless Vercel-serverless + Neon-Postgres app at `https://api.freeswarm.myndlabs.tech`. It handles **auth, subscription, billing, and usage ingest only**. It explicitly does **not** run agents, fusion, or 9Router — those are long-running/WebSocket workloads that can't live on Vercel serverless (`cloud/README.md:7`).

The desktop backend is a thin client: `auth/router.py` and `subscription/router.py` proxy to this service; the web `/app` calls it directly from the browser (`cloud/README.md:13`).

### API surface

| Method | Path | Purpose | File |
|---|---|---|---|
| GET | `/api/health` | Liveness + DB/auth config check | `cloud/api/health.ts:7` |
| GET | `/api/me` | Bearer → `{user_id, email, plan, status, expires, usage}` | `cloud/api/me.ts:9` |
| POST | `/api/auth/signin-activate` | Re-validate handoff token → profile + plan | `cloud/api/auth/signin-activate.ts:11` |
| POST | `/api/auth/dev-login` | `{email}` → `{token}` (gated `ALLOW_DEV_LOGIN=1`) | `cloud/api/auth/dev-login.ts` |
| GET | `/api/auth/google` / `/api/auth/github` | OAuth start + callback (gated on creds) | `cloud/api/auth/{google,github}.ts` |
| POST | `/api/subscription/sync` | Bearer → live plan/period/status | `cloud/api/subscription/sync.ts` |
| POST | `/api/billing/portal` | Bearer → Stripe portal `{url}` | `cloud/api/billing/portal.ts` |
| POST | `/api/billing/webhook` | Stripe webhook | `cloud/api/billing/webhook.ts` |
| POST | `/api/service/sync` | Usage ingest (web mode), idempotent | `cloud/api/service/sync.ts:10` |

### Auth model

Bearer is an **HS256 JWT** minted server-side after sign-in (`jose`, `cloud/lib/auth.ts`). Key points:
- Single token everywhere: desktop receives it from the handoff page; web stores it in an `fs_session` cookie. `extractBearer()` reads either the `Authorization: Bearer` header or the cookie.
- 30-day expiry; `authReady()` refuses to operate unless `AUTH_SECRET` is ≥16 chars (the empty-string fallback "would sign nothing safe").
- `/api/me` returning **401 is a signal**: it tells the desktop the token is dead and to revert to own-key routing (`cloud/api/me.ts:6`).
- `signin-activate` never trusts whatever hit localhost — it re-verifies the token against `AUTH_SECRET` before returning the profile.

### Gotchas / stubs

- `usage: null` is always returned by `/api/me` (`cloud/api/me.ts:32`) — the usage field is stubbed, not yet wired.
- Most paths are gated on optional env (Google/GitHub OAuth, Stripe). Only `DATABASE_URL` + `AUTH_SECRET` are required; everything else "unlocks an optional path" (`cloud/README.md:61`).
- `/api/service/sync` is **deliberately failure-swallowing**: on a storage error it returns `200 {ok:true, stored:false}` so the fire-and-forget client never retries (`cloud/api/service/sync.ts:33`). Idempotent on `(install_id, submission_id)`.

## 7.2 9Router — standalone mode

9Router is a local AI routing gateway (Next.js) that exposes a single OpenAI-compatible `/v1/*` endpoint and routes across upstream providers with translation, fallback, token refresh, and usage tracking (`router/docs/ARCHITECTURE.md:7`). FreeSwarm ships a **vendored fork** ("FreeSwarm Router") rather than consuming npm, to own provider adapters/OAuth/branding (`backend/apps/nine_router/process.py:30`).

- **Port:** `20128`. Base URLs are constants in `backend/apps/nine_router/process.py:25-28`: `NINE_ROUTER_URL=http://localhost:20128`, `/api`, `/v1`.
- **Compatibility routes:** `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/models`, `/v1beta/models` (`router/docs/ARCHITECTURE.md:101`). `next.config.mjs` rewrites `/v1/*` → `/api/v1/*`.
- **Core flow:** entry `src/sse/handlers/chat.js` → `open-sse/handlers/chatCore.js` → `open-sse/executors/*`. Translation registry in `open-sse/translator/index.js`.
- **Persistence:** `src/lib/localDb.js` → `${DATA_DIR}/db.json` (or `~/.9router/db.json`); usage in `~/.9router/usage.json` + `log.txt` (note: usageDb ignores `DATA_DIR`).
- **Specialized executors:** `antigravity`, `gemini-cli`, `github`, `kiro`, `codex`, `cursor`; everything else uses `open-sse/executors/default.js` (`router/docs/ARCHITECTURE.md:451`).

### Subagent model pins

When FreeSwarm spawns a Claude Agent SDK session against 9Router, it must pin the subagent/fast models, otherwise the CLI's default `claude-haiku-4-5-20251001` gets routed somewhere it doesn't exist and 4xx's. The pins are set per-route in `backend/apps/agents/agent_manager.py`:

| Route | `CLAUDE_CODE_SUBAGENT_MODEL` | Source |
|---|---|---|
| Anthropic own-key (route=api) | `claude-sonnet-4-6` | `agent_manager.py:1520` |
| Custom provider, no Anthropic key | `resolved_model` (same endpoint) | `agent_manager.py:1588` |
| OpenRouter, no Anthropic key | `openrouter/anthropic/claude-sonnet-4.5` | `agent_manager.py:1633` |
| FreeSwarm Pro proxy | `claude-sonnet-4-6` | `agent_manager.py:1649` |
| Free-trial | `claude-haiku-4-5-20251001` (clamped) | `agent_manager.py:1665` |

Free-trial is forced to Haiku because the cloud serves every free run as Haiku; a Sonnet subagent makes the CLI attach an `effort` param that Haiku 400s on (`agent_manager.py:1663`).

## 7.3 9Router packaged in the desktop app

### Boot flow & subprocess management

`backend/apps/nine_router/process.py` is the **single owner** of the 9Router process handle (`_process`); nothing else spawns or kills it (`process.py:53`). Sync/oauth modules only talk HTTP to the running server.

`ensure_running()` (`process.py:219`) branch logic:
- **Packaged** (`FREESWARM_PACKAGED=1`): runs the pre-built standalone fork staged at `<resources>/router/`. Tries `server.js`, `.next/standalone/server.js`, `.next/standalone/router/server.js` (`process.py:253`).
- **Dev**: prefers the fork built at `router/.next/standalone/router/server.js`; falls back to installing the pinned npm `9router@<version>` into an XDG cache (`process.py:301`, `_ensure_router_cached`).
- **Dev re-spawn quirk:** if 9Router is already running in dev, it `pkill`s any `next-server` so `next dev` picks up the latest source (`process.py:227-243`).

Spawn command (`process.py:273`): `node [--require <gpt5_patch>] <server.js>` with env `PORT=20128`, `NODE_ENV=production`, `FREESWARM_BUNDLED=1`.

### Node binary resolution

`_find_node()` (`process.py:125`) priority: **(1)** `FREESWARM_NODE_PATH` (bundled real Node, set by Electron) → **(2)** system `node` on PATH → **(3)** `FREESWARM_ELECTRON_PATH` with `ELECTRON_RUN_AS_NODE=1`. The bundled Node is preferred because `ELECTRON_RUN_AS_NODE` causes a bouncing Dock icon on fresh Macs and a ~5-15s cold start vs ~50ms.

Electron stages dual-arch Node at `<resources>/node/{arm64,x64}/bin/node` and exports `FREESWARM_NODE_PATH` into the backend env (`electron/main.js:833`, `electron/main.js:1011-1013`).

### The GPT-5 patch (`--require`)

`_gpt5_patch_path()` (`process.py:102`) injects `backend/apps/agents/9router_gpt5_patch.js` via `node --require`. It intercepts outbound HTTPS to `api.openai.com` and renames `max_tokens` → `max_completion_tokens` for GPT-5 models. Without it every `gpt-5*` own-key session 400s, because OpenAI rejects the legacy field and 9Router emits it (every version including 0.4.20). If the file is missing the flag is dropped and 9Router spawns unpatched (degraded, not broken).

### IPC: OAuth callback interception

Electron intercepts provider OAuth callbacks at the navigation layer rather than relying on `window.opener.postMessage` (which silently no-ops on Anthropic's cross-origin redirect chains). `forwardOauthCallback()` (`electron/main.js:2140`) matches `localhost|127.0.0.1:20128/callback`, extracts `code`/`state`/`error`, and forwards via `mainWindow.webContents.send('freeswarm:oauth-callback', ...)`. Settings.tsx then calls `/api/agents/subscriptions/exchange`. Google/Antigravity/OpenAI providers are routed through `shell.openExternal` instead of embedded windows (embedded browsers get blocked/blank) (`electron/main.js:2095`).

### Liveness caching gotcha

`is_running()` (`process.py:66`) caches a **positive** result for 10s (`_IS_RUNNING_TTL`). The probe is a blocking sync `httpx.get` that can exceed its 2s timeout while 9Router is busy streaming, producing false negatives. Negative results are deliberately **not** cached, so startup detection stays correct.

## 7.4 Request routing & model selection

The model-resolution gate is `backend/apps/agents/providers/registry.py` — "always go through here, never hardcode a model id" (`registry.py:1`).

`BUILTIN_MODELS` (`registry.py:39`) entries carry a `route` field and a `router_model_id` whose prefix decides the lane. The prefixes that **force routing through 9Router** are `_NINEROUTER_MODEL_PREFIXES = ("cc/", "cx/", "gc/", "ag/", "gemini/", "openrouter/")` (`registry.py:34`):

| Prefix | Meaning |
|---|---|
| `cc/` | Claude subscription (pins user's Claude sub regardless of connection_mode) |
| `cx/` | Codex (OpenAI) subscription |
| `gc/` | Gemini CLI subscription |
| `ag/` | Antigravity OAuth lane (Gemini) |
| `gemini/` | Gemini direct API key |
| `openrouter/` | OpenRouter |
| `cp-<slug>/` | Custom OpenAI-compatible provider node |

`resolve_model_id_for_sdk()` (`registry.py:236`) resolves short names → routed ids. Notable logic:
- `combo://` names return the **first** model of the combo; actual fallback iteration happens in 9Router's core, not here (`registry.py:242`).
- Anthropic + `connection_mode in (freeswarm-pro, free-trial)` resolves to the **bare** model id (proxy serves it) instead of `cc/`-prefixed, which would 401 without a connected Claude sub (`registry.py:263`).
- Gemini lane order is **API key → Antigravity OAuth → gc/** (`registry.py:287`). The `_ANTIGRAVITY_MAP` live-queries `:20128/api/providers` to check for an active `antigravity` connection before switching to `ag/`.

`resolve_aux_model()` (`registry.py:314`) picks the cheapest reachable model for one-shot calls (titles, classifiers), staying on the family the user already pays for, and only raises if nothing is connected.

## 7.5 Provider abstraction & cloud-vs-local fallback

The credential ladder lives in `backend/apps/settings/credentials.py` and the env-selection cascade in `agent_manager.py:1500-1700`.

**`get_anthropic_client()` fallback order** (`credentials.py:122`):
1. `connection_mode in (freeswarm-pro, free-trial)` → cloud proxy with bearer (`proxy_auth`, default `https://api.freeswarm.myndlabs.tech`; free-trial appends `/free`).
2. User's own `anthropic_api_key`.
3. 9Router (`api_key="9router"`, `base_url=http://localhost:20128`) — free for users with subscriptions.
4. Raise "No AI provider configured."

`get_anthropic_client_for_model()` (`credentials.py:147`) short-circuits: any `cc/`/`cx/`/`gc/`/`cp-` model goes straight to 9Router so subscriptions reach the user's own accounts.

**`validate_credentials()` (`credentials.py:44`):** if 9Router is up (`_check_9router`), credential validation is skipped entirely — "9Router proxies every provider, so if it's up we don't need keys here."

**Per-route env selection in the agent loop** (`agent_manager.py`), in priority order:
- `route=api` + Anthropic key → direct `api.anthropic.com` (`:1515`).
- `route=api` + OpenAI key → 9Router + `OPENAI_BASE_URL` pointed at the local `/api/openai-passthrough/v1` (the max_tokens fix) (`:1525`).
- `route=api` + custom → ensures 9Router running; routes through synced openai-compatible node (`:1547`).
- `route=api` + Gemini key → local `/api/anthropic-proxy` to scrub JSON-Schema fields Gemini rejects (`:1593`).
- OpenRouter primary → 9Router via the apikey connection (`:1606`).
- Anthropic + Pro/free-trial → cloud proxy bearer, no 9Router (`:1639`).
- Anthropic + own key, no 9Router prefix → direct key (`:1667`).
- Else 9Router running → route through it; Gemini-bound ids detour through the local anthropic-proxy (`:1670`).

### Provider sync into 9Router

Custom OpenAI-compatible providers are mirrored into 9Router "provider nodes" with prefix `cp-<slug>` (`sync_custom.py:23`). The OpenAI passthrough lane registers a node pointing at `http://127.0.0.1:<FREESWARM_PORT>/api/openai-passthrough/v1` (`sync_custom.py:35`). Sync modules **never spawn** the subprocess — HTTP-only against the running server.

## 7.6 Known gotchas & incomplete stubs

- **`ENABLE_TOOL_SEARCH=auto`, never `1`** on 9Router/subagent paths. Forcing `1` marks every tool `defer_loading=true`, which collides with `cache_control` and 400s the Claude subscription route (`backend/CLAUDE.md`; set in every anthropic branch, e.g. `agent_manager.py:1655`).
- **Fork inherits known regressions** from base 9router v0.3.90: cross-provider WebSearch reports unavailability; `max_tokens` emitted for OpenAI (patched at the boundary, not in-router) (`process.py:36`).
- **`usageDb` ignores `DATA_DIR`** — always writes `~/.9router/` (`router/docs/ARCHITECTURE.md:545`).
- **`/api/v1/route.js` returns a static model list**, not the live source used by `/v1/models` (`ARCHITECTURE.md:546`).
- **`/api/me` `usage` field is a stub** (always `null`).
- **Version-nag suppression:** `FREESWARM_BUNDLED=1` tells `router/src/app/api/version/route.js` to suppress the npm "new version available" nag, since the bundled router is updated via Electron auto-updater (`process.py:281`).
- **9Router debug logging** is off by default (stdout/stderr → `/dev/null`); set `FREESWARM_DEBUG_9ROUTER=1` to tee to `backend/data/9router.log` (`process.py:339`).
- **Security defaults to override:** 9Router's `INITIAL_PASSWORD` defaults to `123456`; `JWT_SECRET`/`API_KEY_SECRET` must be set in real deployments (`ARCHITECTURE.md:526`).
