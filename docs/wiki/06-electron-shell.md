# 06 - Electron Shell

The desktop shell that wraps the FreeSwarm frontend + Python backend. Electron is
the CastLabs DRM build (`github:castlabs/electron-releases#v42.0.0+wvcus`,
`electron/package.json:27`). Entry point is `electron/main.js` (`package.json:6`).
Version source of truth: `electron/package.json` `version` (currently `1.2.88`,
`package.json:3`).

All file:line references below are into `electron/` unless otherwise noted.

---

## 1. App boot sequence

Boot runs in two phases: synchronous module-load work (before `whenReady`), then
the async `app.whenReady()` handler.

### 1a. Synchronous module-load (top of main.js)

In order:

1. **E2E switch** — if `FREESWARM_E2E=1`, append Chromium switch `freeswarm-e2e`
   (`main.js:8-10`).
2. **Crash reporter** — local-only Crashpad, `uploadToServer=false`
   (`main.js:13-23`).
3. **Process-level error capture** — `uncaughtException`, `unhandledRejection`,
   `app.on('child-process-gone')` (`main.js:26-36`).
4. **Auto-updater module pick** — platform split: Windows → built-in
   `electron.autoUpdater` (`isSquirrelUpdater=true`); else
   `electron-updater` (`main.js:39-48`).
5. **Squirrel events handler** (`handleSquirrelEvents`, `main.js:68-74`) — Windows
   only. `--squirrel-install`/`--squirrel-updated` → create shortcut + `exit(0)`;
   `--squirrel-uninstall` → remove shortcut + `exit(0)`; `--squirrel-obsolete` →
   `exit(0)`. Runs before any other branching.
6. **NSIS→Squirrel migration cleanup** — on `--squirrel-firstrun`, registers a
   `before-quit` hook to silently uninstall a legacy NSIS install
   (`main.js:84-100`).
7. **Defender prewarm** — `--prewarm` (Windows) touches bundled python/node with
   `--version` then `exit(0)` (`main.js:265-278`).
8. **Deep-link protocol registration** — `app.setAsDefaultProtocolClient('freeswarm')`
   (dev passes execPath + entry script) (`main.js:287-294`). Done synchronously so
   the OS knows the handler before `whenReady`.
9. **Single-instance lock** — `requestSingleInstanceLock()`; if not held,
   `app.exit(0)`. Otherwise wire `second-instance` (focus window + forward
   deep-link from argv) (`main.js:328-343`).
10. **`open-url` handler** (macOS deep links) (`main.js:347-365`).
11. **Chromium command-line switches** — `disable-features` (adds
    `MacWebContentsOcclusion` on darwin), `autoplay-policy`,
    `disable-renderer-backgrounding`, `disable-background-timer-throttling`,
    `disable-gpu-process-crash-limit` (`main.js:374-389`).
12. **`before-quit` forensics + clean-quit lock** (`main.js:568-573`).

### 1b. `app.whenReady().then(...)` (`main.js:1822`)

In order:
1. Delete stale `updating.lock` (`main.js:1825`).
2. `spawnCrashWatchdog()` (macOS packaged only) (`main.js:1829`).
3. `installMacMouseClamp()` (macOS) (`main.js:1832`).
4. Cold-launch deep-link: `extractOpenswarmUrl(process.argv)` →
   `forwardDeepLinkToRenderer` (`main.js:1838-1839`).
5. Dock icon (macOS dev) (`main.js:1841-1843`).
6. Permission request + check handlers (`main.js:1845-1862`).
7. `webRequest.onHeadersReceived` — strips `X-Frame-Options` and CSP
   `frame-ancestors` for `subFrame` only (Windows iframe fallback)
   (`main.js:1865-1883`).
8. DRM request logging interceptors (`main.js:1885-1909`).
9. **Splash window** opens immediately (`createSplashWindow`, `main.js:1914`) +
   `emitSplashStatus('Starting FreeSwarm…')`.
10. **Widevine CDM** warmup started concurrently (not awaited) (`main.js:1923-1937`).
11. **Backend** — dev: read `FREESWARM_PORT` (default 8324), load token, mark ready
    (`main.js:1940-1947`). Prod: `pickBackendPort()` then `startBackend()` fired
    **without await** so the window can paint while Python cold-starts
    (`main.js:1950-1955`).
12. **Frontend HTTP server** (`startFrontendServer`, prod only, awaited)
    (`main.js:1957-1963`).
13. `clearStaleFrontendCache()` (awaited, before window load) (`main.js:1966`).
14. `createWindow()` (`main.js:1967`).
15. `setupAutoUpdater()` (prod) + did-finish-load update-status replay
    (`main.js:1968-1977`).
16. **Splash → main swap** gated on `ready-to-show` AND `backendReady`
    (`swapToMain`, `main.js:1984-2002`); `did-fail-load` fallback for dev
    (`main.js:2007-2016`).
17. `affiliateTracking.maybeRunFirstLaunchHandshake(...)` (fire-and-forget)
    (`main.js:2028-2035`).

The window is created `show:false` (`main.js:1257`); the splash is what the user
sees until React paints `ready-to-show`, then a 120ms-delayed splash destroy
avoids a no-window frame gap on Windows (`main.js:1995-2000`).

### Boot perf instrumentation
`perfMark(name)` writes one-shot `[perf] <name> t=<ms>` lines to backend.log
(`main.js:110-118`). Milestones: `app-launch` (`main.js:1029`),
`backend-http-ready` (`main.js:1122`), `first-paint` (`main.js:1334`),
`first-agent-response` (renderer-reported via IPC, `main.js:2521`). A boot beacon
POSTs `_perfValues` + preflight to `/api/service/event` once first-paint AND
backend-http-ready land (`maybeSendBootBeacon`, `main.js:257-262`,
`sendBootBeacon`, `main.js:226-253`).

---

## 2. Bundled Python backend: dev vs packaged

### Spawn (`startBackend`, `main.js:943-1134`)
- **Command**: `<python> -m uvicorn backend.main:app --host 127.0.0.1 --port <port>`
  (`main.js:1048-1056`), `cwd = projectRoot`, `stdio` all piped.
- **Port**: `pickBackendPort()` races `getPort.makeRange(8324,8424)` (host pinned
  to `127.0.0.1` — load-bearing on Windows) against a 3s timeout; on stall falls
  back to OS-assigned `{port:0}` (`main.js:920-941`).
- **Python path** (`getPythonPath`, `main.js:784-815`):
  - Packaged macOS: `<resources>/python-env/Python.app/Contents/MacOS/python3`
    (LSUIElement wrapper to suppress Dock icon), falls back to `bin/python3`.
  - Packaged Windows: `<resources>/python-env/python.exe`.
  - Packaged Linux: `<resources>/python-env/bin/python3`.
  - Dev: `backend/.venv/Scripts/python.exe` (win) or `backend/.venv/bin/python3`.
- **projectRoot**: `process.resourcesPath` packaged, else `<repo>/..`
  (`main.js:948`).
- **Env injected** (`main.js:974-1023`): `FREESWARM_PACKAGED`, `FREESWARM_PORT`,
  `FREESWARM_ELECTRON_PATH`, `FREESWARM_INSTALL_METHOD` (dev/dmg/windows-setup/
  appimage, overridable), `FREESWARM_APP_VERSION`, `FREESWARM_LOCALE`,
  `FREESWARM_TIMEZONE`, `PYTHONDONTWRITEBYTECODE`, `PYTHONUTF8`, and
  `FREESWARM_NODE_PATH` (bundled node, when present). Packaged also sets
  `PYTHONPATH = projectRoot : debugger : python-env site-packages`
  (`main.js:1016-1023`). `PATH` is resolved via `getShellPath()`
  (`main.js:708-775`) which on packaged macOS asks the login shell for its real
  PATH (Finder/Dock launchd PATH is minimal).
- **Dev**: backend is NOT spawned by Electron; `bash run.sh` runs uvicorn
  separately and Electron connects to the existing port (`main.js:1940-1947`,
  confirmed by `CLAUDE.md:32`).

### Bundled Node (`getBundledNodePath`, `main.js:833-841`)
Packaged only: `<resources>/node/<arch>/bin/node` (or `node.exe` on Windows).
Exposed to the backend as `FREESWARM_NODE_PATH` for spawning 9router + MCP servers
(preferred over system node / Electron-as-Node).

### Auth token (`main.js:1136-1240`)
Backend writes a per-install token to `<data-root>/auth.token` BEFORE binding the
HTTP port. `loadAuthToken()` retries 20×100ms (`main.js:1223-1240`). Path mirrors
`backend/config/paths.py`: macOS `~/Library/Application Support/FreeSwarm/data/`,
Windows `%APPDATA%/FreeSwarm/data/`, Linux `$XDG_DATA_HOME/FreeSwarm/data/`; dev
`backend/data/` (`getAuthTokenFilePath`, `main.js:1155-1173`). Backend log lives
next to it (`backend.log`, `getBackendLogPath`, `main.js:1181-1183`), with 5MB
rotation and the main-process console tee (`openBackendLog`/`installConsoleTee`,
`main.js:1187-1221`).

---

## 3. The 9router (FreeSwarm Router)

Important: **main.js does NOT spawn the router.** The router is a child of the
Python backend (`backend/apps/nine_router/process.py`), runs silently on port
**20128**, exposing an OpenAI-compatible API at `localhost:20128/v1`
(`backend/apps/nine_router/process.py:9-10,25`). It is spawned via
`node server.js` using `FREESWARM_NODE_PATH` (`process.py:125-155`).

main.js' only router involvement:
- Intercepts the router's OAuth `/callback` at `localhost:20128/callback` in the
  global `web-contents-created` navigation handler, forwarding parsed
  `{code,state,error}` to the renderer over `freeswarm:oauth-callback`
  (`main.js:2140-2156`).
- `killBackend` uses `taskkill /T /F` on Windows specifically to also reap the
  router node grandchild (`main.js:1734`).

### Build-time staging (dev vs packaged)
- **macOS / Linux** (`scripts/fetch-router.sh`): rsyncs the vendored Next.js fork
  standalone build (`router/.next/standalone[/router]`) into the staging dir.
  Source-of-truth is the in-repo fork.
- **Windows** (`scripts/fetch-router.ps1`): `npm install 9router@0.3.60`
  (`ROUTER_VERSION` env override) and robocopies `node_modules/9router/app`.
- Packaged: shipped to `<resources>/router` via `extraResources`
  (`package.json:145-153`). Backend resolves it via `_find_9router_dir()` ->
  `<resources>/router` then tries `server.js`,
  `.next/standalone/server.js`, `.next/standalone/router/server.js`
  (`process.py:82-95,247-255`).
- Dev: backend installs `9router@<NINE_ROUTER_NPM_VERSION>` into a cache dir on
  first run (`process.py:155-213`).

> NOTE (doc drift): `electron/CLAUDE.md:18` calls the version pin `0.3.60`
> "load-bearing"; `fetch-router.ps1:8` pins `0.3.60`; but `fetch-router.sh` and
> `process.py:35` reference a vendored fork of `9router v0.3.90`. The .sh and .ps1
> paths produce different artifacts (Next.js standalone vs npm `app/`).

---

## 4. Backend boot-retry, runtime watchdog, recovery signal

### Boot-retry loop (`main.js:1107-1134`)
`MAX_BOOT_ATTEMPTS = 3`. Each attempt `spawnBackend()` then
`waitForBackend(port, {process})`. On failure: kill, back off `1500*attempt` ms,
retry. **Health-poll timeouts are NOT retried** (process alive but hung; retry
just multiplies the wait) — re-thrown immediately (`main.js:1115-1118`). On
success: `perfMark('backend-http-ready')`, commit preflight cache, send beacon,
`loadAuthToken()`, `markBackendReady()`.

### Health check (`waitForBackend`, `main.js:849-911`)
Polls `GET /api/health/check` until 200; rejects if the spawned process
`exit`s non-zero (code !== 0 && !== null) or fires spawn `error`. Hard wall-clock
timeout 10 min; progressive splash warnings at 60s and 180s. Never quits silently.

### `markBackendReady` / lazy gate (`main.js:1143-1153`)
Sets `backendReady=true`, resolves `backendReadyPromise`, and sets
`backendBooted=true` which **arms** the runtime watchdog. Renderer
`get-auth-token` IPC awaits this gate, letting the window open while Python is
still cold-starting (`main.js:2503-2516`).

### Runtime watchdog (`handleBackendExit`, `main.js:1767-1799`)
Wired via `backendProcess.on('exit')` (`main.js:1093-1096`). Guards (all must
fail to proceed): only acts after `backendBooted`; ignores clean exit (0),
signal/own kill (null), `backendIntentionalKill`, and `quitInitiated` ||
`isInstallingUpdate`. Restart cap: **3 in 5 min** (`backendRestartTimes`); on cap
it sets the window title to "FreeSwarm (backend crashed)" and gives up. Otherwise
`respawnBackend()` (closure set at `main.js:1101`, re-spawns on the SAME port),
then `waitForBackend` again.

### `backend-recovered` signal
On successful re-health after a watchdog restart, `sendToRenderer('backend-recovered',
{port})` (`main.js:1793`); the renderer re-establishes API + WS connections.
Preload bridges it as `onBackendRecovered` (`preload.js:146-150`).

`backendIntentionalKill` is set true by `killBackend()` (`main.js:1729`) so a
deliberate teardown (quit, splash-quit, boot failure) doesn't trigger a respawn.

---

## 5. IPC channel catalog

### Diagnostic wrapper (`main.js:2484-2495`)
`ipcMain.handle` is monkey-patched to log `[diag][ipc.handle] <channel>` (CDP-noisy
channels suppressed unless `FREESWARM_DIAG_IPC=1`) and log thrown errors.

### `ipcMain.handle` (request/response, invoke) — preload method in parens
| Channel | Preload bridge | main.js |
|---|---|---|
| `get-backend-port` | (sync mirror used instead) | 2497 |
| `get-auth-token` | `getAuthToken` | 2503 |
| `perf:first-agent-response` (on) | `markFirstAgentResponse` | 2521 |
| `get-app-version` | `getAppVersion` | 2523 |
| `get-build-info` | `getBuildInfo` | 2526 |
| `get-webview-preload-path` | `getWebviewPreloadPath` (uses sync) | 2527 |
| `get-update-status` | `getUpdateStatus` | 2531 |
| `get-crash-recovery-info` | `getCrashRecoveryInfo` | 2538 |
| `check-for-updates` | `checkForUpdates` | 2554 |
| `download-update` | `downloadUpdate` | 2577 |
| `set-allow-prerelease` | `setAllowPrerelease` | 2589 |
| `install-update` | `installUpdate` | 2641 |
| `capture-page` | `capturePage` | 2645 |
| `open-external` | `openExternal` | 2662 |
| `get-install-state` | `getInstallState` | 2671 |
| `send-cdp-command` | `sendCdpCommand` | 2827 |
| `cdp-cache-set` | `cdpCacheSet` | 2839 |
| `cdp-cache-get` | `cdpCacheGet` | 2844 |
| `cdp-cache-clear` | `cdpCacheClear` | 2848 |
| `cdp-child-sessions-get` | `cdpChildSessionsGet` | 2855 |
| `cdp-routes-get` | `cdpRoutesGet` | 2863 |
| `get-webview-console` | `getWebviewConsole` | 2873 |
| `connect-slack` | `connectSlack` | 2875 |

### `ipcMain.on` (one-way / sync)
| Channel | Kind | Source | main.js |
|---|---|---|---|
| `splash:action` | from splash.html | quit/restart/open-logs | 2454 |
| `get-backend-port-sync` | sendSync | preload.js:18 | 2499 |
| `get-webview-preload-path-sync` | sendSync | preload.js:19 | 2500 |
| `perf:first-agent-response` | send | preload.js:51 | 2521 |

### Main → renderer (`sendToRenderer` / `webContents.send`)
Receiver methods are in preload (`preload.js:74-150`):
`update-available`, `update-not-available`, `download-progress`,
`update-downloaded`, `update-error` (`onUpdate*`/`onDownloadProgress`);
`webview-new-window` (`onWebviewNewWindow`); `freeswarm:auth-url` (`onAuthUrl`);
`freeswarm:oauth-claim` (`onOauthClaim`); `freeswarm:window-focus`
(`onWindowFocus`, throttled 2s/direction, `main.js:1429-1438`);
`freeswarm:oauth-callback` (`onOauthCallback`); `backend-recovered`
(`onBackendRecovered`).

### Preload bridge mechanics (`preload.js`)
`contextBridge.exposeInMainWorld('freeswarm', {...})` with
`contextIsolation:true`, `nodeIntegration:false` (`main.js:1259-1268`). Port +
webview-preload path are read **synchronously** via `sendSync` so
`window.freeswarm` exists before the first frontend bundle evaluates
(`preload.js:17-21`). The auth token is deliberately NOT a window global — only
reachable via `getAuthToken()` invoke so leaked webview scripts can't scrape it
(`preload.js:33-41`). `getBackendPortLive()` re-queries for self-heal
(`preload.js:28-30`). E2E flag exposed as `__FREESWARM_E2E__` (`preload.js:10-15`).

---

## 6. Auto-updater split

Module pick at load (`main.js:39-48`): Windows → built-in `electron.autoUpdater`
(Squirrel.Windows; `isSquirrelUpdater=true`); macOS/other → `electron-updater`.

### Windows (Squirrel)
- `setupAutoUpdater` sets feed via `setFeedURL({url: GH .../releases/latest/download/})`
  (`main.js:1607-1615`). No `autoDownload`/`allowPrerelease`/`allowDowngrade`
  knobs.
- `update-*` events fire with NO/positional args; handlers normalize them
  (`main.js:1632-1656`).
- `set-allow-prerelease` returns "not yet supported on Windows Squirrel"
  (`main.js:2592`) — TODO.
- `download-update` no-ops (auto-downloads on detect) (`main.js:2580`).
- `quitAndInstall()` takes no args (`main.js:2622`).

### macOS (electron-updater)
- `autoDownload=true`, `autoInstallOnAppQuit=true`, `allowPrerelease=false`,
  `allowDowngrade=true` (`main.js:1620-1626`).
- `quitAndInstall(false, true)` (`main.js:2623`).

### Shared
- Initial check on setup; periodic re-check every **4h**
  (`main.js:1687-1691`).
- **Idle auto-install heuristic** (`main.js:1697-1723`): every 5 min, if a staged
  update exists AND uptime > 2h AND system idle > 30 min AND backend reports 0
  active agents (`GET /api/agents/activity`), install silently.
- `installDownloadedUpdate()` (`main.js:2610-2639`): sets `isInstallingUpdate`,
  writes the Mac `updating.lock`, POSTs `/api/outputs/shutdown-all` to reap App
  Builder subprocesses, then `quitAndInstall`. 30s safety-net timer un-sticks the
  flag + recreates a window if Squirrel never quit.
- `friendlyUpdateError` maps raw errors to user copy (`main.js:1549-1561`).
- Only fires in packaged builds (`check-for-updates` rejects when `!isPackaged`,
  `main.js:2555`).

---

## 7. Deep links (`freeswarm://`)

- Registered synchronously at module load via `setAsDefaultProtocolClient`
  (`main.js:287-294`).
- **Routing** (`forwardDeepLinkToRenderer`, `main.js:300-322`): host `oauth` +
  path ending `/complete` → `freeswarm:oauth-claim`; everything else →
  `freeswarm:auth-url` (legacy/subscription token). Malformed URLs fall back to
  the legacy channel.
- **Capture by platform**:
  - macOS: `app.on('open-url')` (`main.js:347-365`); reopens a windowless
    keep-alive app if needed.
  - Windows/Linux: arrives in argv → `second-instance` handler
    (`main.js:332-342`) or cold-launch `extractOpenswarmUrl(process.argv)` in
    `whenReady` (`main.js:1838-1839`).
- **Cold-launch stash**: if no window yet, `pendingDeepLink = {channel, url}`
  (`main.js:296-321`), flushed in the window's `did-finish-load`
  (`main.js:1333-1344`).
- Used by OAuth + Stripe return flows (`CLAUDE.md:34`); must be tested in a
  packaged build, not the dev shell.

---

## 8. Window management

- **Splash**: frameless 460x340, `nodeIntegration:true`/`contextIsolation:false`
  (self-contained data URL), closes on main `ready-to-show`; closing it before
  main appears quits the app + kills backend (`main.js:601-648`).
- **Main**: 1400x900, `titleBarStyle:'hiddenInset'`, `show:false`, preload +
  `contextIsolation`, `webviewTag:true` (`main.js:1242-1269`). Loads
  `http://localhost:3000` (dev), `http://127.0.0.1:<frontendServerPort>/index.html`
  (prod), or `file://` fallback (`main.js:1271-1279`).
- **Frontend HTTP server** (`startFrontendServer`, `main.js:420-510`): in-process
  Node http server over loopback serving `<resources>/frontend`. Pins
  `PREFERRED_PORT = 4173` (stable origin for localStorage), OS-assigned fallback.
  Strips `/app` prefix (webpack publicPath), SPA fallback to index.html, path-
  traversal guard. **The file:// origin segfaults Windows CastLabs Electron;
  loopback HTTP is the canonical fix** (`main.js:418`, `CLAUDE.md:48`).
- **macOS close-to-dock**: non-quit closes (`quitInitiated=false`,
  `!isInstallingUpdate`) are `preventDefault`'d and the window is HIDDEN, keeping
  renderer/webviews/agents alive (`main.js:1352-1389`); `activate` re-shows
  (`main.js:2417-2449`). `window-all-closed` keeps the process alive on macOS,
  quits on Win/Linux (`main.js:2327-2362`).
- **Renderer crash recovery** (`main.js:1402-1417`, `recreateMainWindow`,
  `main.js:1472-1508`): `render-process-gone` RECREATES the window (reload hits a
  NOTREACHED DCHECK on this Electron build), capped 3 in 60s, then a native
  recovery dialog (`showCrashRecoveryOverlay`, `main.js:1511-1533`).
- **Popup / OAuth windows** (`web-contents-created`, `main.js:2054-2129`): spoofs
  a Chrome UA on popup windows (Google/OpenAI blacklist the Electron token);
  `setWindowOpenHandler` routes tabs to `webview-new-window`, opens auth popups
  as 520x680 children.
- **Quit drain** (`before-quit`, `main.js:2393-2410`): POSTs
  `/api/outputs/shutdown-all` (10s) to reap subprocesses, then quits; `will-quit`
  → `killBackend()` (`main.js:2413-2415`).

---

## 9. macOS crash watchdog (`crash-watchdog.js`)

Detached child spawned by `spawnCrashWatchdog` (packaged macOS only,
`main.js:528-552`) with `ELECTRON_RUN_AS_NODE=1` and parent PID/start-time env.
Polls the parent PID every 2s; on parent death relaunches via
`open -n <app bundle>` only if **all five guards** pass
(`crash-watchdog.js:71-111`):
1. darwin + env vars populated (checked at load, `:29-31`).
2. parent uptime > `MIN_UPTIME_MS=30s` (rules out startup crash loop).
3. no `clean-quit.lock` (written by `before-quit`, `main.js:554-560`; consumed).
4. no `updating.lock` (written around update swap, `main.js:2616-2617`).
5. `< MAX_RELAUNCHES=3` in the last hour (`:42-45`).

Writes `crash-recovery.json` on relaunch; main.js reads + deletes it via
`get-crash-recovery-info` (Mac-only) to show a one-time "recovered" chip
(`main.js:2538-2552`). All failure modes exit silently (`:17-18`).

---

## 10. CDP bridge & webview preload

### CDP (`main.js:2679-2873`, `cdp-routes.js`)
The browser sub-agent drives webviews via Chrome DevTools Protocol. Per-webContents
state: AX index cache, serialized command queue, OOPIF child sessions, captured
routes, console error ring (`main.js:2687-2698`). `ensureDebuggerAttached` attaches
lazily on first use + auto-attaches cross-origin child frames
(`main.js:2747-2770`). Commands are serialized per wcId and raced against a 10s
timeout with one detach/reattach retry (`main.js:2776-2825`).
`cdp-routes.js` is a pure (no-Electron) module that passively records XHR/fetch
endpoints from `Network.requestWillBeSent`, templating volatile path segments,
redacting secret headers/params, keeping only body key-shape, capped at 200/wc
(`cdp-routes.js:13-152`).

### webview-preload.js (`main.js:1281-1302` forces it on every `<webview>`)
Anti-fingerprinting (`navigator.webdriver=false`, fake plugins, `window.chrome`,
languages, permissions, visibility) (`webview-preload.js:13-91`). Acts as the
passkey postMessage→`sendToHost` bridge (the actual WebAuthn shim is injected
main-world by main.js on `dom-ready`, `main.js:2244-2287`). Forwards ctrl/meta+wheel
zoom and non-interactive dblclick to the host, and mirrors page `console.*` to the
host for the App Builder terminal (`webview-preload.js:131-246`).

---

## 11. Build / packaging (`package.json` `build`)

- `appId: com.clusterlabs.freeswarm`, `productName: FreeSwarm`,
  `afterPack: build/after-pack.js`, `afterSign: scripts/notarize.js`
  (`package.json:32-34,174`).
- **mac**: dmg + zip, hardened runtime, entitlements, mouseclamp extraResource per
  arch (`package.json:45-64`).
- **win**: target `squirrel` x64; custom signtool `build/sign-windows.js`
  (`package.json:82-99`). NSIS config also present (`oneClick`, perMachine=false,
  `deleteAppDataOnUninstall:false`, `installer-recovery.nsh`) for the legacy/
  alternate target (`package.json:103-113`).
- **extraResources** staged from `build-staging/`: `frontend`, `backend` (excl
  tests/pycache), `debugger`, `python-env`, `router`, `node/<arch>`,
  `uv-bin/<arch>` → `backend/uv-bin` (`package.json:114-168`).
- **publish**: GitHub `yethikrishna/free-swarm` (`package.json:169-173`).
- Scripts: `dist`/`dist:win`/`dist:all`, `postinstall: sign-vmp.js` (Widevine VMP
  signing), `test: affiliateTracking.test.js` (`package.json:7-19`).
- `npm run build` → `build-staging/` (frontend dist, backend bundle, standalone
  Python 3.13, 9router) (`CLAUDE.md:11`). Windows release signed via Azure in CI
  on `v*` tags (`CLAUDE.md:13`).

---

## 12. Affiliate tracking (`affiliateTracking.js`)

First-launch handshake (`maybeRunFirstLaunchHandshake`, `:121-180`): generates an
`app_install_id` UUID, persists `<userData>/install.json` (atomic temp+rename),
opens `https://freeswarm.myndlabs.tech/welcome?app_install_id=…` in the system
browser, and polls `/api/install/lookup` (12×5s) until a `ref` binds. Skipped in
dev unless `FREESWARM_AFFILIATE_FORCE=1` (`:125-127`). Returning launches re-poll
silently only within a 24h grace window (`:130-149`). Renderer reads state via
`get-install-state` IPC → `_readState` (`main.js:2671-2677`).

---

## Gotchas & invariants

- **Renderer origin port must be stable.** localStorage is keyed by origin incl.
  port; the frontend server pins 4173, OS-assigned only as fallback
  (`main.js:483-508`, `CLAUDE.md:47`).
- **`webSecurity` stays on.** The file:// segfault is fixed by loopback HTTP, never
  by disabling CSP (`main.js:377,418`, `CLAUDE.md:48`).
- **Backend writes auth.token BEFORE binding HTTP.** The shell reads it after
  health passes (`main.js:1127-1132`, `CLAUDE.md:32`).
- **`pickBackendPort` must probe `127.0.0.1`** not 0.0.0.0, or Windows hands back a
  loopback-occupied port (`main.js:920-931`).
- **Backend is NOT awaited at boot** — window paints while Python cold-starts;
  renderer blocks on `get-auth-token`'s `backendReadyPromise` gate
  (`main.js:1949-1955`, `2503-2505`).
- **Don't `killBackend()` in `window-all-closed`** (Win/Linux) — `before-quit`
  must POST `/shutdown-all` first or orphaned vite node.exe locks
  `resources\node\...\node.exe` and blocks the next NSIS upgrade
  (`main.js:2353-2361`).
- **`isInstallingUpdate` must let window `close` through** on macOS, else
  quitAndInstall hides the window and strands the update (`main.js:1363-1367`).
- **Webview preload is forced via `will-attach-webview`**, not a React attribute
  (raced empty) (`main.js:1290-1298`).
- **UA spoof skips the main window + webviews** via `isCreatingMainWindow` flag +
  type check (`main.js:415-416,2070-2075`).
- **Crash recovery RECREATES, never reloads** (reload → NOTREACHED abort on this
  Electron build) (`main.js:1398,1464-1471`).
- **Per-platform scope every workaround** and **crash watchdogs need EVERY guard**
  (`CLAUDE.md:50-51`).
- The CastLabs Electron version in `package.json` is **v42.0.0** while `CLAUDE.md`
  and several inline comments say "Electron 40"/"Electron 42" interchangeably.

## Incomplete / dead / TODO

- **Windows experimental/prerelease channel**: `set-allow-prerelease` explicitly
  unsupported on Squirrel ("not yet supported", `main.js:2592`); a separate
  Squirrel prerelease feed is a noted TODO (`main.js:2591`).
- **9router version doc drift**: `0.3.60` pin (`fetch-router.ps1:8`, `CLAUDE.md:18`)
  vs vendored fork `v0.3.90` (`fetch-router.sh`, `process.py:35`); .sh and .ps1
  stage structurally different artifacts.
- **`get-backend-port` (`handle`)** exists (`main.js:2497`) but the preload only
  uses the sync mirror `get-backend-port-sync`; the async handle has no preload
  caller.
- **`get-webview-preload-path` (`handle`)** (`main.js:2527`) is shadowed by the
  sync variant the preload actually uses (`preload.js:31`,
  `get-webview-preload-path-sync`).
- **`file://` fallback** in `createWindow` (`main.js:1276-1278`) is a known-
  segfaulting last resort, kept only as "better than a white screen".
- **CLAUDE.md "Electron 40" references** are stale vs the v42 dep.
- `nine_router.py` is referenced in main.js comments (`main.js:2103`) but the
  module is actually the package `backend/apps/nine_router/`.
