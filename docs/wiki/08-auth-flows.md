# 08 - Auth flows & intermixing gaps

> **Status: gating doc for the device-login refactor.** Grounded in `file:line`.
> Read alongside `backend/CLAUDE.md` ("Bearer token (`auth.py`)") and
> `electron/CLAUDE.md` ("Deep links (`freeswarm://`)").

FreeSwarm runs in three deployment surfaces, each with a *separate* credential
and a *separate* notion of "signed in." They overlap at exactly one place (the
OAuth bearer-handoff page) and that overlap is where the bugs live.

| Surface | What "auth" means | Credential | Stored where | Validated where |
|---|---|---|---|---|
| **Desktop app** (Electron + local backend) | Gate the localhost API/WS so other local processes can't drive the agent | Per-install opaque token (`secrets.token_urlsafe(32)`) | `<data-root>/auth.token`, mode `0600` | `backend/auth.py:227` `request_matches_token` (constant-time) |
| **Web** (`/app`, hosted, no local backend) | Identify the cloud account | Cloud JWT (HS256, 30d) | `localStorage['fs_web_token']` (`frontend/src/shared/cloud.ts:7`) | cloud `GET /api/me` |
| **Cloud** (Vercel functions, `api.freeswarm.myndlabs.tech`) | Mint + verify account identity, run Stripe | Cloud JWT (HS256, 30d) | issued by `cloud/lib/auth.ts:20` `mintToken` | `cloud/lib/auth.ts:29` `verifyToken` |

There is **also** a fourth, unrelated credential surface: third-party AI provider
logins (Claude/Codex/Gemini/Qwen subscriptions) routed through the bundled
9Router. Those are device-code/auth-code OAuth flows that have nothing to do with
FreeSwarm *account* identity; they are covered in
[§ Device-code flow](#device-code-flow-third-party-providers-only) so the refactor
does not conflate them with FreeSwarm sign-in.

---

## 1. Desktop app local auth (the install bearer)

This is the only credential that exists in a fresh, never-signed-in install.

- **Mint / load**: `backend/auth.py:32` `init_auth_token()`. Reads
  `AUTH_TOKEN_FILE` if present and 16–512 chars; otherwise mints
  `secrets.token_urlsafe(32)` and writes it atomically at mode `0600`
  (`_write_atomic`, `backend/auth.py:16`). **Ordering invariant**: generated
  *before* the HTTP bind so Electron can read it off disk (`backend/CLAUDE.md`).
- **File location**: `electron/main.js:1155` `getAuthTokenFilePath()` —
  `~/Library/Application Support/FreeSwarm/data/auth.token` (mac),
  `%APPDATA%/FreeSwarm/data/auth.token` (win), `$XDG.../FreeSwarm/data/auth.token`
  (linux), `backend/data/auth.token` (dev).
- **Electron read**: `electron/main.js:2503` IPC `get-auth-token` re-reads the
  file on *every* call (comment at `:2506`: backend may rotate; never cache a dead
  token). Preload exposes it as `freeswarm.getAuthToken()`
  (`electron/preload.js:41`); it is deliberately *not* a plain window global
  (`preload.js:37`).
- **Renderer use**: `frontend/src/shared/config.ts:35` `refreshAuthToken()` →
  caches in `_authTokenCache`; a global `fetch` interceptor
  (`config.ts:92` `_installAuthFetchInterceptor`) stamps
  `Authorization: Bearer <install-token>` on every request to `API_BASE`/`WS_BASE`
  unless the caller already set it.
- **Validation**: `backend/auth.py:227` `request_matches_token` accepts the token
  via `Authorization: Bearer`, `x-freeswarm-token`, or `?token=` (WS), compared
  with `secrets.compare_digest`. Fails **closed** if the backend hasn't
  initialized (`_TOKEN == ""`).
- **Origin allowlist (WS)**: `backend/auth.py:267` `is_origin_allowed` permits
  `file://`, `localhost:3000`, `null`, and any `localhost:`/`127.0.0.1:` origin.
- **Log hygiene**: `_TokenScrubFilter` (`backend/auth.py:63`) redacts the token
  from every log record/handler.

### Auth-exempt paths (pre-flight + redirect callbacks)

`backend/auth.py:175` `_AUTH_EXEMPT_EXACT` / `:194` `_AUTH_EXEMPT_PREFIX`. These
bypass the install-token gate:

| Path | Why exempt | Risk note |
|---|---|---|
| `/api/auth/signin-activate` | OAuth handoff page POSTs from `api.*` origin, can't carry the local bearer | **Unauthenticated localhost write** — see Gap A |
| `/api/subscription/activate` | deep-link handler | listed exempt but actually called *with* a body token it re-validates upstream |
| `/api/subscriptions/callback`, `/api/tools/oauth/callback`, `/api/tools/oauth/cloud-claim` | external redirects "with their own nonce/state validation" (per comment) | state validation is weak — see Gap E |
| `/api/health*`, `/api/version` | Electron polls before token load | benign |
| `/api/dev/token` | dev split-port handoff; 404s in packaged builds | dev-only |
| `/api/openai-passthrough*`, `/api/tools/google-oauth-token` | carry a *different* (provider) bearer; localhost-bind is the gate | provider creds, not FreeSwarm identity |

**No token refresh/expiry** exists for the install bearer: it is a static opaque
secret, reused across restarts (`init_auth_token` comment, `:33`). Rotation would
require deleting `auth.token`; Electron re-reads per call so it would pick up a new
one, but nothing rotates it today.

---

## 2. Web mode auth (cloud JWT)

The hosted `/app` build has **no local backend**; `IS_WEB` is computed at
`frontend/src/shared/config.ts:25` (not Electron, not localhost). It talks
straight to the cloud via `frontend/src/shared/cloud.ts`.

- **Token storage**: `localStorage['fs_web_token']` —
  `getCloudToken`/`setCloudToken`/`clearCloudToken` (`cloud.ts:9-31`).
- **Acquisition paths**:
  1. **Email dev-login**: `WebApp.tsx:57` → `devLogin()` (`cloud.ts:54`) →
     `POST /api/auth/dev-login`. Gated by cloud `ALLOW_DEV_LOGIN=1`
     (`cloud/api/auth/dev-login.ts:13`), else 404.
  2. **GitHub OAuth**: `WebApp.tsx:48` redirects the *whole tab* to
     `…/api/auth/github?redirect_to=/account&client=web`. The handoff page
     (`cloud/api/auth/github.ts:175`) redirects back to the web origin with
     `?token=…` in the URL.
  3. **URL token capture**: `WebApp.tsx:148` reads `?token=` on mount, calls
     `setCloudToken`, then `history.replaceState` to strip it.
- **Validation**: `fetchMe(token)` (`cloud.ts:65`) → `GET /api/me` with
  `Authorization: Bearer`. 401 ⇒ token dead ⇒ `clearCloudToken()` and back to the
  login view (`WebApp.tsx:169`).
- **No cookie is ever set by the web app.** The cloud's `extractBearer`
  (`cloud/lib/auth.ts:41`) is willing to read an `fs_session` cookie, and the
  module comment at `auth.ts:2` claims "the web app stores it in a cookie" — but
  the actual web client stores it in `localStorage` and sends it as a header. The
  cookie branch is dead. See **Gap B**.

---

## 3. Cloud OAuth / magic-link / Stripe

All cloud handlers are Vercel functions under `cloud/api/`. CORS + preflight via
`cloud/lib/http.ts` (`handlePreflight` must be called first in every handler).

### Token model (`cloud/lib/auth.ts`)

- HS256 JWT signed with `process.env.AUTH_SECRET` (must be ≥16 chars,
  `authReady()` at `:10`). Claims: `sub` (user id), `email`. **30-day expiry**
  (`mintToken`, `:26`). The same JWT is the bearer in *all* three surfaces
  (comment, `auth.ts:1`).
- `verifyToken` (`:29`) returns null on any failure. **No refresh token, no
  rotation, no revocation list** — a leaked JWT is valid for 30 days regardless of
  sign-out (sign-out only deletes the *local* copy; see Gap D).

### OAuth handlers (`google.ts`, `github.ts`)

Both follow the same two-phase shape:

1. **No `?code`** → build base64url `state = {local_port, redirect_to, client}`
   (`google.ts:26`, `github.ts:25`) and `302` to the provider consent screen.
2. **`?code` present** → exchange code → read verified email → `upsertUser` →
   `mintToken` → render the **bearer-handoff HTML page**
   (`google.ts:82`, `github.ts:86`).

Env-gated: return `501` until `{GOOGLE,GITHUB}_CLIENT_ID/SECRET/REDIRECT_URI` are
set, so the service deploys green before creds exist (`google.ts:17`).

### The bearer-handoff page (the one cross-surface seam)

Identical logic in `google.ts:139` and `github.ts:143`. Inlined JS:

- If `client !== 'web'` (desktop): `POST http://localhost:<local_port>/api/auth/signin-activate`
  with `{token, signin_method, email}`, 3s timeout. On `ok`, `window.close()`.
- Else (or on desktop-timeout fallback): redirect the browser to
  `WEB_APP_ORIGIN + redirect_to` with `?token=<jwt>` appended
  (`google.ts:174-180`). Comment at `:171`: localStorage is origin-scoped so the
  token must travel in the URL to be readable on the web origin.

This is the **only** place a cloud JWT crosses into a non-cloud surface, and it
crosses two different ways (localhost POST for desktop, URL param for web). The
device-login refactor lives or dies on getting this seam right.

### Desktop-side activation endpoints

The desktop backend mirrors the cloud (`backend/apps/auth/router.py`,
`backend/apps/subscription/router.py`):

| Endpoint | Source trigger | What it does |
|---|---|---|
| `POST /api/auth/signin-activate` | handoff page localhost POST | re-validates token at cloud `…/signin-activate` (`router.py:107`), persists `user_id/email/signin_method`; flips `connection_mode='freeswarm-pro'` **only** if cloud returns a paid plan (`router.py:144`) |
| `POST /api/auth/signout` | Settings UI (`settingsSlice.ts:241`) | calls cloud `…/auth/signout` (**which does not exist** — Gap D), stops in-flight agents, clears local identity (`router.py:176`) |
| `POST /api/subscription/activate` | `freeswarm://auth` deep link (`useDeepLink.ts:61`) | validates via cloud `GET /api/me`, persists plan/expires (`subscription/router.py:111`) |
| `GET /api/subscription/status` | Settings card | live `GET /api/me`; on `401/402` clears local creds (`router.py:222`) |
| `POST /api/subscription/sync` | per-launch | reconciles plan vs Stripe via cloud `…/subscription/sync` |
| `POST /api/billing/portal` (cloud) | Settings → portal | Stripe Customer Portal URL (`cloud/api/billing/portal.ts:31`) |

### Stripe

- **Webhook**: `cloud/api/billing/webhook.ts`. Verifies HMAC
  (`stripe.webhooks.constructEvent`, `:32`); updates the subscription row on
  `customer.subscription.{created,updated,deleted}`. Env-gated 501 until
  `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. **Known fragility flagged in the
  code itself** (`webhook.ts:28`): `req.body` is re-stringified to reconstruct the
  raw body for signature verification — "an approximation"; a body Vercel parsed
  and re-serialized differently will fail verification. See Gap F.
- **Portal return**: hard-codes `/app` return URL off `VERCEL_URL` or the literal
  domain (`portal.ts:34`).
- **Stripe checkout return** reaches the desktop as `freeswarm://auth?token=…`
  (`electron/preload.js:107` comment), routed to `activateSubscription`.

---

## 4. Device-code flow (third-party providers only) {#device-code-flow-third-party-providers-only}

**This is not FreeSwarm account auth.** It logs the user into their *own* Claude /
Codex / Gemini / Qwen subscription so the agent can route LLM calls through them
via the bundled 9Router.

- **Frontend**: `frontend/.../subscription/subscriptionConnect.ts:14`
  `runDeviceCodeFlow` (popup + dual poller + focus safety-net + 5-min timeout) and
  `:133` `runAuthCodeFlow`. Dispatched by `flow` field at `:216`.
- **Backend**: `backend/apps/nine_router/oauth.py` — start/poll/exchange against
  the running 9Router; includes the **Codex fixed-callback listener on
  `localhost:1455`** (`oauth.py:_CODEX_CALLBACK_PORT`) because OpenAI's client
  rejects arbitrary redirect URIs. Anthropic/Google use 9Router's `:20128`
  callback page.
- **Callback relay**: postMessage → `window.opener`, with an Electron IPC fallback
  (`onOauthCallback`, `subscriptionConnect.ts:198`) for when cross-origin redirects
  sever `window.opener`.

The standalone `router/` Next.js subproject (`router/src/app/login/page.js`,
`router/src/app/api/auth/{login,logout}`, `router/src/sse/services/tokenRefresh.js`)
is the *self-hosted 9Router dashboard* — a separable product with its own session
cookie auth and its own provider-token refresh loop. It is **out of scope** for
FreeSwarm account identity and must not be merged into the device-login refactor.

---

## 5. Token refresh / expiry logic

| Credential | Expiry | Refresh | Revocation |
|---|---|---|---|
| Install bearer | none (static) | re-read per IPC call | delete `auth.token` |
| Cloud JWT | 30d hard (`mintToken`) | **none** | **none** (no blocklist) |
| Subscription state | `expires` from `/api/me` | per-launch `/sync`, on-view `/status` | `401`/`402` ⇒ local clear (`subscription/router.py:222`) |
| Provider OAuth (9Router) | provider-defined | `router/src/sse/services/tokenRefresh.js` (router product) | per-provider |

The cloud JWT has **no renewal path**: at day 30 every desktop and web session
silently fails `GET /api/me` with 401 and the user is bounced to sign-in with no
warning. There is no refresh-token grant and no sliding window.

---

## 6. Callback URL routing & state validation

- **Deep link registration**: `electron/main.js:290` `setAsDefaultProtocolClient('freeswarm')`.
- **Routing by host**: `electron/main.js:300` `forwardDeepLinkToRenderer` —
  `host === 'auth'` → `freeswarm:auth-url`; `host === 'oauth' && path endsWith /complete`
  → `freeswarm:oauth-claim`. Cold-launch links stash in `pendingDeepLink`
  (`:298`), flushed once the renderer is ready.
- **Renderer handling**: `frontend/src/shared/hooks/useDeepLink.ts`. `auth` →
  if `signin=true` → `activateSignin`, else → `activateSubscription` (`:36`/`:61`).
  `oauth/{provider}/complete` → `POST /api/tools/oauth/claim` (`:104`).
- **State validation**: cloud OAuth `state` is base64url
  `{local_port, redirect_to, client}` (`google.ts:26`). It is a **carrier, not a
  CSRF nonce**: no random value, no server-side store, no comparison on return
  (`google.ts:66-71` just decodes it). `redirect_to` is allowlisted to
  `/app`|`/account` and `client` to `web`, but `local_port` is taken from the
  request and only digit-checked. See Gap E.

---

## Gap resolution status (device-login refactor)

The device-login refactor landed on branch `claude/gifted-gates-r327i6` across
five phases (cloud token foundation → cloud OAuth → Electron keychain → backend
validation → frontend). Status of each gap below; details follow.

| Gap | Status | How it was closed |
|---|---|---|
| A — unauthenticated localhost write | **Closed** | `/api/auth/begin-signin` mints an install nonce (`auth/router.py`); `signin-activate` requires + consumes it (single-use, 5-min TTL). The cloud carries it through OAuth and echoes it in the handoff POST. |
| B — split-brain web token | **Closed** | `extractBearer` prefers `fs_web_token`; `fs_session` cookie demoted to one-release legacy fallback (`cloud/lib/auth.ts`). Web client stays header+localStorage. |
| C — missing `google/start` route | **Closed** | `cloud/api/auth/google/start.ts` (GET) generates PKCE + CSRF nonce and 302s to consent. `google.ts` no-code branch forwards to it (single path). |
| D — sign-out cannot revoke | **Closed** | `cloud/api/auth/signout.ts` revokes all JTIs + refresh tokens (`revoked_jtis`/`refresh_tokens` tables). Tokens now carry `jti`; `verifyToken` can check the revocation list. |
| E — `state` is not a CSRF nonce | **Closed** | `state` now carries only a single-use server-side nonce (`oauth_nonces`, 10-min TTL); handoff metadata + PKCE verifier are recovered server-side, never trusted from the URL. |
| F — `expires`/`current_period_end` mismatch | **Noted** | `me.ts` already returns ISO `expires`; the `subscription/router.py:154` consumer read remains the spot to align (tracked; not part of the auth-token refactor). |
| G — cross-surface token collision | **Closed** | Tokens are audience-scoped (`aud: desktop\|web\|cloud`). `signin-activate` enforces `aud=desktop`; web redirect carries `aud=web`. A web token can no longer be activated on desktop. |
| H — dead `signin=true` deep-link | **Closed (wired emitter)** | Both handoff pages now emit `freeswarm://auth?signin=true&token=…&refresh_token=…` as a fallback when the localhost POST fails. `useDeepLink` reads the refresh token + nonce + method. |

**Also added (beyond the original gaps):**
- **Refresh tokens.** 15-min access + 30-day refresh pair (`mintAccessToken`/`mintRefreshToken`). `POST /api/auth/refresh` (cloud + backend) silently re-mints the access token; `fetchMe` retries once on 401 before signing out. No more day-30 hard logout.
- **OS-keychain API keys (military-grade).** Provider keys live in the OS keychain (Electron `safeStorage`: Keychain/DPAPI/libsecret) and are pushed into a RAM-only backend store (`secret_store.py`) on boot. `credentials.py` resolves keychain-first, settings.json fallback. Endpoints: `/api/settings/secrets/{push,clear,present}`. Fully additive; covered by `tests/test_secret_store.py`.

### Remaining follow-ups
- ~~Remove keys from disk by default.~~ **Done.** On keychain-capable installs the
  ApiKeyCard writes keys straight to the OS keychain (never the settings form),
  `/secrets/push` blanks any keychained field on disk, `update_settings` force-blanks
  fields already in the store, and boot migrates any legacy on-disk keys into the
  keychain. Keys now live only in the OS keychain + RAM. Dev/headless without a
  keychain falls back to settings.json as before. Covered by `tests/test_keychain_secrets.py`.
- ~~**Gap F consumer fix** in `subscription/router.py`.~~ **Done.** `/api/subscription/activate`
  now reads both `current_period_end` (ms) and `expires` (ISO) from the cloud, matching
  what `signin-activate` already accepts; whichever the cloud sends resolves correctly.
- ~~**Desktop access-token expiry signed users out.**~~ **Done.** `subscription/status` got
  a 401 from cloud `/api/me` and immediately cleared the subscription, logging out paying
  users every 15 min (the access-token lifetime). It now calls `_try_refresh_bearer()` to
  silently re-mint from the 30d refresh token and retries once; only a dead/missing refresh
  token drops the subscription. Covered by `tests/test_subscription_refresh.py` (3 cases).
- ~~**SignInDialog gave no handoff feedback.**~~ **Done.** The dialog now shows a
  waiting state (spinner + "Finish in your browser") after a provider is clicked and a
  success state ("Signed in as {email}") that auto-closes, instead of polling silently.
- **Device-code flow for FreeSwarm account** (RFC 8628) is designed but not yet built (Phase 5);
  distinct from the 9Router third-party provider device flows. Deferred: it needs a cloud-side
  `/device/code` + `/device/token` pair to build against, and adding it blind would violate
  the "no unverified code" constraint. Tracked for when the cloud endpoints land.

---

## Critical gaps (original audit — see resolution table above)

These are the blockers the device-login separation must close. Each is grounded.

### Gap A — `signin-activate` is an unauthenticated localhost write
`/api/auth/signin-activate` is auth-exempt (`backend/auth.py:181`) and persists
`user_id/email/bearer` to settings after only re-validating the token upstream
(`backend/apps/auth/router.py:91`). Any local process (or a malicious web page
able to reach `localhost:<port>`; the handoff page does exactly this from a remote
origin) can POST a *valid attacker-minted* cloud JWT and silently re-identify the
desktop install as the attacker's account, including flipping it into
`freeswarm-pro` if that account is paid (`router.py:144`). The upstream
re-validation proves the token is *a* valid token, not that *this user* initiated
the sign-in. The refactor needs an originating-nonce bound to the local install.

### Gap B — Web token storage contract is split-brained (`localStorage` vs cookie)
`cloud/lib/auth.ts:2`/`:41` documents and implements an `fs_session` **cookie**
path; the web client only ever uses `localStorage['fs_web_token']` + an
`Authorization` header (`frontend/src/shared/cloud.ts:7`). No code path sets
`fs_session`. Result: the cookie branch is dead, and any future server-rendered or
SSR surface that assumes the cookie will see "signed out." Pick one
(header+localStorage *or* httpOnly cookie) before adding a device-login surface
that needs to read the web session.

### Gap C — `SignInDialog` calls cloud routes that do not exist
`frontend/.../SignInDialog.tsx:52` opens `…/api/auth/google/start?…` and `:58`
`…/api/auth/github?…`. The cloud has **only** `cloud/api/auth/google.ts` and
`github.ts` (verified: no `google/start`, no `email` handler). So the desktop
"Continue with Google" button hits a 404 (`google/start` doesn't exist), while
GitHub happens to work because the path matches. The dialog also advertises "Email
sign-in coming soon" but `devLogin` (email) only works on the web build. Desktop
Google sign-in is currently broken end-to-end.

### Gap D — Sign-out cannot revoke; cloud has no `signout` route
`backend/apps/auth/router.py:192` POSTs to cloud `…/api/auth/signout`, but
`cloud/api/auth/` contains no `signout.ts` (verified). The cloud JWT has no
revocation list (`cloud/lib/auth.ts`). So "Sign out" only deletes the *local*
copy; the 30-day JWT remains fully valid anywhere it leaked (a synced settings
file, a browser URL-bar history entry from the web `?token=` redirect, logs that
predate the scrubber). Cross-surface: a desktop sign-out does not invalidate a web
session minted from the same account, and vice versa.

### Gap E — OAuth `state` is not a CSRF nonce
`google.ts`/`github.ts` use `state` purely to carry `{local_port, redirect_to,
client}` and never verify it against a server-side value (`google.ts:66`). An
attacker can craft the callback with their own `state` (their `local_port`,
`client=desktop`) to steer the handoff POST at a victim's localhost, or fix
`redirect_to`/`client`. Combined with Gap A this is a full account-injection chain.
The "external redirects with their own nonce/state validation" claim in
`backend/auth.py:174` is **aspirational** for the FreeSwarm OAuth path.

### Gap F — `expires`/`current_period_end` field mismatch on activation
`subscription/router.py:154` reads `me.get("current_period_end")` (expects unix
ms) from cloud `GET /api/me`, but `cloud/api/me.ts:29` returns `expires` as an
**ISO string** (and no `current_period_end`). So deep-link subscription activation
never populates the expiry from the cloud; it falls back to the deep-link's own
`expires` only if present (`router.py:161`). The Stripe webhook's re-stringified
raw-body signature check (`webhook.ts:28`) is a second, code-flagged fragility on
the same billing path.

### Gap G — Cross-surface token collision on a shared machine
The handoff page tries the desktop localhost POST *first* for any non-`web` client
(`google.ts:151`). If a user signs in **on the web** but a desktop app is also
running, the comment at `google.ts:148` notes the race and guards it with
`client==='web'`; but the guard depends entirely on the `client` query param being
correctly threaded from `WebApp.tsx:49` (`client=web`) through `state` and back. If
that param is dropped or spoofed (Gap E), a web sign-in can be **swallowed by the
desktop's localhost endpoint**, leaving the web tab signed-out and the desktop
silently re-identified. The three surfaces share one JWT shape and one localhost
ingestion point with no per-surface audience claim (`mintToken` sets no `aud`,
`cloud/lib/auth.ts:20`).

### Gap H — Dead `signin=true` deep-link branch
`useDeepLink.ts:36` handles `freeswarm://auth?signin=true` for free sign-in, but
**no code anywhere emits that URL** (verified: the only producers of
`freeswarm://auth` are Stripe checkout returns, which carry a subscription token,
not `signin=true`; OAuth sign-in uses the localhost-POST path instead). So the
desktop free-sign-in deep-link path is unreachable. The refactor should either
wire an emitter (cloud handoff page emitting the deep link) or delete the branch —
right now desktop sign-in relies solely on the auth-exempt localhost POST (Gap A).

---

## Pre-flight / initialization order (load-bearing)

1. **Backend**: `init_auth_token()` runs **before the HTTP bind**
   (`backend/CLAUDE.md`; `backend/auth.py:32`) so the file exists when Electron
   reads it. `install_token_scrubber()` attaches before logging traffic.
2. **Electron**: loads the token before `markBackendReady`
   (`electron/main.js:1944`) so the first renderer fetch carries a real bearer, not
   `''` (which would 401).
3. **Renderer**: `config.ts:165` calls `ensureAuthToken()` at module load and
   installs the fetch interceptor (`:164`) before any page fetch.
4. **Web**: `WebApp.tsx:148` captures `?token=` synchronously in a `useMemo`
   before the first `fetchMe`, then strips it from the URL.
5. **Cloud**: every handler calls `handlePreflight` first (`cloud/lib/http.ts:18`)
   and `verifyToken`/`extractBearer` before touching the DB.

For the device-login refactor: surfaces (1)–(3) are the *install* identity;
(4)–(5) are the *account* identity. They must stop sharing the
`signin-activate` localhost seam and the single un-audienced JWT before device
logins can be reasoned about independently.
