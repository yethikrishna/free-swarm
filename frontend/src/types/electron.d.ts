export {};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          preload?: string;
          partition?: string;
          allowpopups?: string;
          nodeintegration?: string;
          webpreferences?: string;
          useragent?: string;
        },
        HTMLElement
      >;
    }
  }

  interface FreeSwarmUpdateInfo {
    version: string;
    releaseDate?: string;
    releaseNotes?: string | Array<{ version: string; note: string }>;
  }

  interface FreeSwarmDownloadProgress {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
  }

  interface FreeSwarmAPI {
    getBackendPort: () => number;
    getWebviewPreloadPath: () => string;
    getAppVersion: () => Promise<string>;
    getBuildInfo: () => Promise<{ sha: string; shortSha: string; builtAt: string | null; channel: string }>;
    getUpdateStatus: () => Promise<{ status: string; info: any; error: string | null }>;
    getCrashRecoveryInfo?: () => Promise<{ ts: number; parent_pid: number; uptime_ms: number } | null>;
    checkForUpdates: () => Promise<{ success: boolean; version?: string; error?: string }>;
    downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
    installUpdate: () => Promise<void>;
    onUpdateAvailable: (cb: (info: FreeSwarmUpdateInfo) => void) => () => void;
    onUpdateNotAvailable: (cb: (info: FreeSwarmUpdateInfo) => void) => () => void;
    onDownloadProgress: (cb: (progress: FreeSwarmDownloadProgress) => void) => () => void;
    onUpdateDownloaded: (cb: (info: FreeSwarmUpdateInfo) => void) => () => void;
    onUpdateError: (cb: (message: string) => void) => () => void;
    onWebviewNewWindow: (cb: (url: string, webContentsId: number) => void) => () => void;
    onBackendRecovered?: (cb: (payload: { port: number }) => void) => () => void;
    openExternal: (url: string) => Promise<void>;
    onAuthUrl?: (cb: (url: string) => void) => () => void;
    onOauthClaim?: (cb: (url: string) => void) => () => void;
  }

  interface Window {
    __FREESWARM_PORT__: number;
    freeswarm: FreeSwarmAPI;
  }
}
