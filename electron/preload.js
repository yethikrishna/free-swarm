const { contextBridge, ipcRenderer } = require('electron');

// eslint-disable-next-line no-console
console.log('[diag][preload] start, ua=', navigator.userAgent);

// E2E gate: set the renderer flag BEFORE any page script parses so the
// production-build store-on-window expose fires deterministically when
// Playwright launches with FREESWARM_E2E=1. Read from the Chromium switch
// the main process appended; no-op for normal user launches.
try {
  const args = (typeof process !== 'undefined' && process.argv) ? process.argv : [];
  if (args.some((a) => /--freeswarm-e2e(=1)?$/.test(a))) {
    contextBridge.exposeInMainWorld('__FREESWARM_E2E__', true);
  }
} catch (e) { console.log('[diag][preload] e2e-flag setup failed:', e && e.message); }

// Synchronous exposure. The previous async IIFE (await ipcRenderer.invoke) raced React mount: any code reading window.freeswarm during the gap (BrowserCard's Electron-detection falling back to iframe mode, AgentChat's auth-token call throwing) saw undefined. sendSync blocks the renderer for one IPC round-trip during preload before any user-visible paint, so window.freeswarm is guaranteed to exist before the first frontend bundle evaluates.
const port = ipcRenderer.sendSync('get-backend-port-sync');
const webviewPreloadPath = ipcRenderer.sendSync('get-webview-preload-path-sync');

contextBridge.exposeInMainWorld('__FREESWARM_PORT__', port);

contextBridge.exposeInMainWorld('freeswarm', {
  getBackendPort: () => port,
  // Fresh re-query of the LIVE backend port (not the cached preload value).
  // Used by the renderer to self-heal if its cached port ever resolved wrong
  // (raced null -> 8324, or backend on a fallback port because 8324 was held).
  getBackendPortLive: () => {
    try { return ipcRenderer.sendSync('get-backend-port-sync'); } catch (_) { return port; }
  },
  getWebviewPreloadPath: () => webviewPreloadPath,

  // Per-install auth token required for WS + HTTP calls to the
  // localhost backend. Returns a Promise<string>. The renderer should
  // await this on startup and include the token on every WS URL
  // (`?token=...`) and HTTP request (`Authorization: Bearer ...`).
  // We deliberately do NOT expose the token as a plain window global
  // or a sync getter: contextBridge + IPC keeps it off the renderer's
  // global object so third-party scripts (including any code that
  // leaks through <webview>) can't scrape it.
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),

  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Phase 2 provenance: { sha, shortSha, builtAt, channel } for the About panel.
  getBuildInfo: () => ipcRenderer.invoke('get-build-info'),

  // Phase 0 boot instrumentation: renderer calls this exactly once, when the
  // first streamed token of the first agent response paints. Fire-and-forget
  // (send, not invoke) so it never blocks the render path. Main dedupes.
  markFirstAgentResponse: () => ipcRenderer.send('perf:first-agent-response'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Returns the persisted install state (app_install_id, ref, ...).
  // Renderer attaches the ref to Stripe checkout + sign-in flows so
  // the cloud can credit the affiliate. Resolves to {} if no state yet.
  getInstallState: () => ipcRenderer.invoke('get-install-state'),
  connectSlack: () => ipcRenderer.invoke('connect-slack'),
  sendCdpCommand: (wcId, method, params, sessionId) => ipcRenderer.invoke('send-cdp-command', wcId, method, params, sessionId),
  cdpCacheSet: (wcId, indexMap) => ipcRenderer.invoke('cdp-cache-set', wcId, indexMap),
  cdpCacheGet: (wcId) => ipcRenderer.invoke('cdp-cache-get', wcId),
  cdpCacheClear: (wcId) => ipcRenderer.invoke('cdp-cache-clear', wcId),
  cdpChildSessionsGet: (wcId) => ipcRenderer.invoke('cdp-child-sessions-get', wcId),
  cdpRoutesGet: (wcId, originFilter) => ipcRenderer.invoke('cdp-routes-get', wcId, originFilter),
  getWebviewConsole: (wcId) => ipcRenderer.invoke('get-webview-console', wcId),
  capturePage: (rect) => ipcRenderer.invoke('capture-page', rect),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  getCrashRecoveryInfo: () => ipcRenderer.invoke('get-crash-recovery-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  setAllowPrerelease: (value) => ipcRenderer.invoke('set-allow-prerelease', value),

  onUpdateAvailable: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  onUpdateNotAvailable: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('update-not-available', listener);
    return () => ipcRenderer.removeListener('update-not-available', listener);
  },
  onDownloadProgress: (cb) => {
    const listener = (_event, progress) => cb(progress);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onUpdateDownloaded: (cb) => {
    const listener = (_event, info) => cb(info);
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.removeListener('update-downloaded', listener);
  },
  onUpdateError: (cb) => {
    const listener = (_event, message) => cb(message);
    ipcRenderer.on('update-error', listener);
    return () => ipcRenderer.removeListener('update-error', listener);
  },

  onWebviewNewWindow: (cb) => {
    const listener = (_event, url, webContentsId) => cb(url, webContentsId);
    ipcRenderer.on('webview-new-window', listener);
    return () => ipcRenderer.removeListener('webview-new-window', listener);
  },

  // Deep-link callback: fires when the OS opens the app with an
  // freeswarm://auth?token=... URL (after Stripe-hosted checkout).
  onAuthUrl: (cb) => {
    const listener = (_event, url) => cb(url);
    ipcRenderer.on('freeswarm:auth-url', listener);
    return () => ipcRenderer.removeListener('freeswarm:auth-url', listener);
  },

  // OAuth claim deep-link channel. Receives freeswarm://oauth/{provider}/complete
  // after the user finishes an OAuth flow in their browser.
  onOauthClaim: (cb) => {
    const listener = (_event, url) => cb(url);
    ipcRenderer.on('freeswarm:oauth-claim', listener);
    return () => ipcRenderer.removeListener('freeswarm:oauth-claim', listener);
  },

  // Window blur/focus events: analytics signal for "user switched to
  // another app" (temp-churn measurement). Throttled in main.js to at
  // most once per 2s per direction so OS-level focus storms don't
  // pollute the event stream.
  onWindowFocus: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('freeswarm:window-focus', listener);
    return () => ipcRenderer.removeListener('freeswarm:window-focus', listener);
  },

  // OAuth popup callback. Fires when any child webContents navigates
  // to localhost:20128/callback?code=... main.js watches for this and
  // forwards the parsed params here. Used as a belt-and-suspenders
  // alongside window.opener.postMessage (which silently fails on some
  // Anthropic flows that reset the opener chain during redirect).
  onOauthCallback: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('freeswarm:oauth-callback', listener);
    return () => ipcRenderer.removeListener('freeswarm:oauth-callback', listener);
  },

  // Backend recovery callback: fires when the backend watchdog relaunches
  // the backend process on the same port after a crash. Renderer should
  // re-establish API and WebSocket connections.
  onBackendRecovered: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on('backend-recovered', listener);
    return () => ipcRenderer.removeListener('backend-recovered', listener);
  },

  // Phase 2 keychain: OS-secure storage for secrets (API keys, tokens).
  // IPC-only; never stored in plaintext in settings.json or window globals.
  setSecret: (key, plaintext) => ipcRenderer.invoke('secret:set', key, plaintext),
  getSecret: (key) => ipcRenderer.invoke('secret:get', key),
  deleteSecret: (key) => ipcRenderer.invoke('secret:delete', key),
  listSecrets: () => ipcRenderer.invoke('secret:list'),

  // Phase 2 auth: mint a one-time nonce for sign-in (proves this install initiated the flow).
  beginSignin: () => ipcRenderer.invoke('auth:begin-signin');
  },
});
