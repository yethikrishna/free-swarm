# 04 - Frontend Architecture

Scope: `frontend/src/app`, `frontend/src/shared` — `Main.tsx` bootstrap, AppShell layout, Redux store architecture, auth flow, theme setup.

> Status: complete code-read. Line numbers accurate at time of writing; re-grep if files have shifted.

## Entry point & bootstrap (`src/index.tsx`)

`index.tsx` is the true entry, not `Main.tsx`. Its async `bootstrap()` (`index.tsx:11`) decides which app to mount and in what order:

1. **Account-portal split** (`index.tsx:13-24`): if `window.location.pathname` is `/account` or under it, it lazy-imports `./web/WebApp` and renders that instead of the canvas app. This is the hosted sign-in / plan / OAuth-landing surface.
2. **Web OAuth token capture** (`index.tsx:28-36`): when `IS_WEB`, reads `?token=...` from the URL, persists it via `setCloudToken` (localStorage key `fs_web_token`, `cloud.ts:7`), then `history.replaceState` cleans the URL.
3. **Startup migrations** (`index.tsx:39`): `runStartupMigrations()` runs *desktop-only* (`!IS_WEB`) and *before* `ensureAuthToken` reads localStorage. The single migration (`migrations.ts:11`) force-clears `freeswarm.auth.token` + onboarding flags for the v1.0.31 re-login; each migration is gated by a `localStorage` `done` flag and must be idempotent.
4. **Auth token race** (`index.tsx:42-47`): `ensureAuthToken()` is raced against a 3s timeout so a missing Electron preload (plain-browser dev) can't hang boot; a resulting 401 is intentional there.
5. `createRoot(root).render(<ErrorBoundary scope="root"><Main /></ErrorBoundary>)` (`index.tsx:48`).

`config.ts` runs side effects at import time, before any of the above: it installs the global fetch interceptor (`config.ts:164`) and kicks `ensureAuthToken()` (`config.ts:165`).

## `Main.tsx` provider tree & route table

`Main` (`Main.tsx:587`) is just the provider stack: `Provider store` → `ThemeProvider` → `ThemedApp`. `ThemedApp` (`Main.tsx:483`) builds the MUI theme and lays out the nested provider/listener chain inside a `HashRouter` (`Main.tsx:516`):

```
HashRouter
  RouteTrackerMount            // useRouteTracker, must be in router (Main.tsx:582)
  SettingsLoader               // gates first paint on settings (215)
    DefaultModelGuard          // reconciles default_model (296)
    BackendRecoveryListener    // watchdog reconnect chip (397)
    UpdateListener             // electron autoupdate -> redux (445)
      CrashRecoveryChip        // mac watchdog relaunch chip (355)
      DeepLinkListener         // useDeepLink/useWindowFocus/useInteractionHeartbeat (208)
        ErrorBoundary scope="routes" -> Suspense -> Routes
        OnboardingErrorGuard -> OnboardingRoot (lazy)
```

Routes (`Main.tsx:526-538`) all nest under a single `<AppShell />` layout route. Note `/dashboard/:id` renders `element={null}` (`Main.tsx:530`) — the Dashboard is rendered persistently *inside* AppShell so Electron webviews survive navigation, not by the router.

**Route lazy-loading + prefetch:** pages are `React.lazy` (`Main.tsx:27-35`). On `window`, `__freeswarmPrefetchRoute(path)` (`Main.tsx:53`) maps a path to a dynamic `import()` for hover-prefetch (AppShell calls it on `onMouseEnter`, `AppShell.tsx:893`), and `prefetchAll` warms every chunk via `requestIdleCallback` with a 1500ms timeout (`Main.tsx:65-77`).

**Diagnostic global handlers** (`Main.tsx:39-51`): `window.error` and `unhandledrejection` log `[diag]`-prefixed stacks because the packaged bundle has no source maps; this is the only stack context that reaches main-process stderr.

## Bootstrap provider responsibilities

| Component | File:line | What it does / why |
|---|---|---|
| `SettingsLoader` | `Main.tsx:215` | On mount dispatches `fetchSettings` + `fetchModels`, then `POST /subscription/sync`, then `POST /subscription/free-trial/mint`, refetching settings after each. **Returns `null` until `settings.loaded`** so the user's theme paints first (Electron `ready-to-show` relies on this). Re-fetches settings on window `focus`. Pushes `theme` into `useThemeMode().setMode` and `allow_experimental_updates` into the Electron prerelease flag. |
| `DefaultModelGuard` | `Main.tsx:296` | After both settings + models load, checks `default_model` against reachable models; if gone, picks a fallback via `DEFAULT_MODEL_PRIORITY`/`DEFAULT_MODEL_PICKS` (`Main.tsx:261-275`), dispatches `updateSettings`, and shows a one-time Snackbar. `pendingRef` guards against re-firing. |
| `UpdateListener` | `Main.tsx:445` | Bridges Electron autoupdate IPC (`window.freeswarm.onUpdate*`) into `updateSlice` actions; reads cached status on mount; returns cleanup array. |
| `BackendRecoveryListener` | `Main.tsx:397` | Subscribes to `onBackendRecovered` (runtime watchdog); on fire re-dispatches `fetchSettings`/`fetchModels` and shows a 3s "reconnecting" chip. |
| `CrashRecoveryChip` | `Main.tsx:355` | Mac-only; reads `getCrashRecoveryInfo()` and shows an 8s recovery chip if the watchdog relaunched. |
| `OnboardingErrorGuard` | `Main.tsx:565` | Local `ErrorBoundary scope="onboarding"` with `fallback={null}`; on error dispatches `setPanelMode('hidden')` and `disableOnboardingAfterCrash()` so a tour crash can't blank the whole app or recur next launch. |
| `RouteTrackerMount` | `Main.tsx:582` | Mounts `useRouteTracker` (must be inside router to call `useLocation`). |

## Config & environment routing (`shared/config.ts`)

- **Backend address** (`config.ts:6-15`): `port` resolves from `window.__FREESWARM_PORT__` (preload-injected) → `freeswarm.getBackendPortLive()` → fallback `8324`. `API_BASE = http://{host}:{port}/api`, `WS_BASE = ws://{host}:{port}`.
- **`FREESWARM_DEFAULT_PROXY_URL`** = `https://api.freeswarm.myndlabs.tech` (`config.ts:17`); must match cloud's `PUBLIC_BASE_URL` and the Google OAuth redirect.
- **Runtime mode** (`config.ts:23-25`): `_isElectron = !!window.freeswarm`; `_isLocalhost` covers `localhost`/`127.0.0.1`/`''`. **`IS_WEB = !_isElectron && !_isLocalhost`** — i.e. the hosted `/app` deployment. Mirrors backend `config/mode.py`.
- **Auth token** (`config.ts:31-65`): `_authTokenCache` resolved once via `ensureAuthToken()` (shared promise). `refreshAuthToken()` prefers `freeswarm.getAuthToken()`; in split-port dev it falls back to `GET /api/dev/token` (404s in packaged builds).
- **Global fetch interceptor** (`config.ts:92-164`, idempotent via `__FREESWARM_FETCH_PATCHED__`): for our-API URLs only, injects `Authorization: Bearer` if the caller didn't set one; **dedupes + caches GETs in a 1s window** (`_GET_CACHE_TTL_MS`, key `GET <url>`), never caches non-2xx, never touches mutations. On a network error it calls `_maybeHealBackendPort()` (`config.ts:72`) which reloads once onto the live port if it differs.

The **cloud client** (`cloud.ts`) is web-only: `devLogin`, `fetchMe`, `subscriptionSync` hit `FREESWARM_DEFAULT_PROXY_URL/api/*` directly with the `fs_web_token` bearer. The desktop build never imports it (it proxies through the local backend).

## Redux store (`shared/state/store.ts`)

`configureStore` with 18 slices (`store.ts:21-39`): `tempState, agents, streaming, skills, tools, modes, settings, mcpRegistry, skillRegistry, outputs, dashboardLayout, dashboards, update, models, interaction, subscriptions, onboardingProgress`. Typed access is via `useAppDispatch`/`useAppSelector` (`shared/hooks.ts`), `RootState`/`AppDispatch` exported from the store.

**Dev-mode invariant middleware is disabled** (`store.ts:51-55`, `serializableCheck:false`, `immutableCheck:false`): the deep-walk caused 30-50ms pauses on hot paths (streaming, WS heartbeats). Trade-off: a `Map`/`Date` accidentally placed in state won't be caught in dev. The store is exposed on `window.__FREESWARM_STORE__` only in dev or when `__FREESWARM_E2E__` is preset (`store.ts:65`).

### `settingsSlice` (the central slice)

`AppSettings` (`settingsSlice.ts:58-100`) is the big config object: model/mode defaults, API keys per provider, `custom_providers`, `model_combos`/`aliases`/`pricing_overrides`, and the subscription/identity block (`connection_mode: 'own_key' | 'freeswarm-pro' | 'free-trial'`, `free_trial_token`, `user_id`/`user_email`/`signin_method`). `DEFAULT_SYSTEM_PROMPT` (`settingsSlice.ts:6`) is the shipped agent prompt.

Thunks: `fetchSettings` (GET), `updateSettings` (PUT), `resetSystemPrompt`, `browseDirectories`, plus the auth/subscription thunks `activateSubscription`, `activateSignin`, `signOut`, `disconnectSubscription` (each refetches settings after).

**Stale-write protection** (`settingsSlice.ts:132,291-319`): `latestWriteId` holds the newest request id. On boot three settings fetches race (initial, sub-sync, free-trial mint); `fetchSettings.fulfilled` **drops any response whose `requestId !== latestWriteId`** (`settingsSlice.ts:300`) so a slow pre-mint GET can't wipe an armed trial. It also skips ref assignment when the JSON is byte-identical (`settingsSlice.ts:302-306`) to stop background polls re-firing effects. A user save claims `latestWriteId` as authoritative (`settingsSlice.ts:313`). `freeTrialArmSettled` (`settingsSlice.ts:285`) gates the "no model" banner until mint settles.

Reducers also drive the Settings modal (`openSettingsModal(tab?)`, `closeSettingsModal`) and draft persistence (`setDraft`/`clearDraft`) so in-flight form edits survive a modal close.

### Other notable slices

- `modelsSlice` (`modelsSlice.ts`): `byProvider: Record<string, ModelOption[]>` from `GET /agents/models`. **Marks `loaded` even on reject** (`modelsSlice.ts:49`) so callers fall back to hardcoded options. `ModelOption` carries `context_window`, `tiers`, `billing_kind`.
- `updateSlice` (`updateSlice.ts`): pure-reducer state machine `idle → checking → available → downloading → downloaded`/`error`, plus `installing`.
- `interactionSlice`, `tempStateSlice`, `onboardingProgressSlice` (the last persists to localStorage via `persistToStorage`/`loadFromStorage`, `onboardingProgressSlice.ts:39,66`).

## AppShell layout (`app/components/Layout/AppShell.tsx`)

Single layout route for every page. Top-to-bottom flex column (`AppShell.tsx:397`):

1. **Title bar** (`:398`): 38px, `WebkitAppRegion:'drag'` for the Electron frameless window; holds the sidebar toggle, back/forward (driven by `window.history.state.idx` vs a tracked `maxHistoryIdx`, `:92-96`), `DynamicIsland`, and the FreeSwarm logo (`src="./logo.png"` — relative for `file://` prod).
2. **Warning banner** (`:507`): shown when offline OR (`modelsLoaded && freeTrialArmSettled && !hasModelConnected && !freeTrialActive`) (`:157`). The free-trial gate prevents a misleading red flash for new users.
3. **Update banner** (`:552`) + **Snackbar** (`:1178`), driven by `updateSlice`.
4. **Body** (`:647`): collapsible sidebar (resizable 160-400px, persisted to `freeswarm-sidebar-width`, `:53-57,105`) with Dashboards / Customization / Apps / Settings sections, then the content panel.

**Persistent dashboard pattern** (`:1140-1170`): the `<Outlet/>` is `visibility:hidden` (not unmounted) on dashboard routes (`:1158`); a `DashboardHost` renders the real `Dashboard` layered above and CSS-hidden on other routes so webviews + canvas state survive navigation.

**Navigation wrapper** (`:73-80`): `navigate` is wrapped in `startTransition` so route swaps are non-urgent and the click handler returns immediately. The Customization items use a manual click handler, not `NavLink`, specifically because NavLink's internal navigate bypasses that wrapper (`:885`). `Settings` is `React.lazy` and idle-prefetched (`:34,208-217`).

## Theme system & design tokens

Two layers:

- **`ThemeContext`** (`shared/styles/ThemeContext.tsx`): React context holding `mode` + `tokens`. Initial mode from `localStorage['self-swarm-theme-mode']` then `prefers-color-scheme` (`:15-22`); persisted on change. Exposes `useClaudeTokens()` and `useThemeMode()`.
- **`claudeTokens.ts`**: `lightTokens`/`darkTokens` (`ClaudeTokens` interface, `:1-12`) — Anthropic-styled palette (accent `#ae5630`/`#c4633a`), uniform `radius` 8, `font.sans = "Anthropic Sans"`, single `transition` curve. `claude` is a `@deprecated` alias for `lightTokens` (`:117`).

`Main.tsx`'s `buildMuiTheme(c, mode)` (`Main.tsx:87`) maps tokens → a full MUI theme (palette, typography, `borderRadius: c.radius.xl`, component overrides for scrollbars, Button, Paper, Dialog, Tooltip). It's `useMemo`'d on `[c, mode]` (`Main.tsx:486`). Separately, `motionTokens.ts` provides `DURATION_MS`/`EASE`/`pulseKeyframes` for animation timing.

## Custom hooks (`shared/hooks/`)

| Hook | File | Purpose |
|---|---|---|
| `useAppDispatch`/`useAppSelector` | `shared/hooks.ts` | Typed Redux access |
| `useDeepLink` | `hooks/useDeepLink.ts` | Subscribes to `freeswarm://auth` (sign-in / Stripe) and `freeswarm://oauth/.../complete` IPC; dispatches `activateSignin`/`activateSubscription` then refetches models, or `POST /tools/oauth/claim` then `fetchTools`. No-op in browser. |
| `useRouteTracker` | `hooks/useRouteTracker.ts` | `report('nav','route_changed')` on location change; skips first render. |
| `useWindowFocus` | `hooks/useWindowFocus.ts` | Reports `focus_lost`/`focus_gained` with timing from Electron blur/focus IPC. |
| `useInteractionHeartbeat` | `hooks/useInteractionHeartbeat.ts` | 1s-debounced `interactionRecorded` on key/mouse/scroll/wheel/touch. |
| `useProviderStatus` | `hooks/useProviderStatus.ts` | Polls `GET /agents/providers/status` every 60s (3s min interval), exposes `routerOffline`. |
| `useLastDashboardId` | `hooks/useLastDashboardId.ts` | Persisted last-open dashboard id (used for the persistent Dashboard mount). |

There is no single `useSettings`/`useModels`/`useAuth` hook — those concerns are read directly off Redux selectors (`useAppSelector(s => s.settings.data)` etc.); auth flows live in `settingsSlice` thunks + `useDeepLink`/`cloud.ts`.

## Telemetry (`shared/serviceClient.ts`)

`report(surface, action, props, {immediate})` → batched `POST /service/submit` (1s flush timer, single-or-array body, `keepalive:true`, flush on `pagehide`). Each event is stamped with a `submission_id` + client `t` for dedupe/ordering. A 20-entry ring buffer feeds `getRecentActions()`, which `ErrorBoundary` and `ThemedApp`'s error handler attach as breadcrumbs.

## Gotchas & invariants

- **`SettingsLoader` returns `null` until `settings.loaded`** (`Main.tsx:257`): nothing below it renders pre-settings; Electron `ready-to-show` depends on this. Don't move first-paint work above it.
- **Newest-write-wins on settings** (`settingsSlice.ts:300`): any code that resolves a settings fetch out of band must respect `latestWriteId` or it can clobber an armed free trial.
- **`config.ts` GET interceptor caches for 1s** (`config.ts:90`): two reads of the same URL within 1s share one response. If you need a guaranteed-fresh read, use POST or bust the window. Mutations are never cached/deduped (intentional, to preserve double-clicks).
- **`runStartupMigrations` is desktop-only and runs before auth** (`index.tsx:39`): web builds skip it; migrations must stay idempotent (gated by `done` flags).
- **`/dashboard/:id` route element is `null`** (`Main.tsx:530`): the Dashboard is mounted persistently in AppShell, hidden via CSS visibility — never unmounted on nav, so webviews survive. Don't "fix" it into a normal route.
- **`navigate` is `startTransition`-wrapped** (`AppShell.tsx:73`): bypassing it (e.g. `NavLink`, raw `navigateRaw`) reintroduces the click-then-wait gap.
- **Dev invariant middleware off** (`store.ts:51`): non-serializable values in state won't error in dev. Keep slice shapes plain.
- **`IS_WEB` is "neither Electron nor localhost"** (`config.ts:25`): a dev server on a non-localhost host would be misclassified as web.
- **Token race timeout is 3s** (`index.tsx:43`): in plain-browser dev with no Electron bridge, expect a 401 — it's intentional, not a bug.
- **`models.loaded` is set even on fetch failure** (`modelsSlice.ts:49`): `loaded` means "attempt finished", not "models present"; gate on `Object.keys(byProvider).length`.
- **Onboarding crashes are contained** (`Main.tsx:565`): `OnboardingRoot` mounts *beside* the routes under its own boundary; a throw there disables the tour rather than blanking the app.

## Incomplete / dead / TODO

- **`claudeTokens.claude`** (`claudeTokens.ts:117`) is `@deprecated` (light-only, no dark support); replace usages with `useClaudeTokens()`.
- **`/apps/new`** is navigated to from "New app" (`AppShell.tsx:393`) but the route table only declares `/apps` and `/apps/:id` (`Main.tsx:535-536`), so `new` is handled as an `:id` by `Views`. Verify `Views` treats `new` as a create sentinel.
- **`fileId` upload path** for Express export and similar `Main`-adjacent flows are not in scope here; no dead code found in the bootstrap path itself.
- `signin_method` deep-link parsing reads `signin_method` but is hardcoded to `'google'` for now (`useDeepLink.ts:31,38` — "1.0.29 only ships Google sign-in; read for forward compat").
