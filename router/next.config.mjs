import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  // Windows EPERM defense (secondary to NODE_PRESERVE_SYMLINKS in the Windows
  // build script): tell @vercel/nft's tracer to skip Windows user/system
  // directories that contain junction points which throw EPERM on scandir
  // (e.g. C:\Users\*\Application Data). Every pattern here is a Windows-only
  // path, so on macOS/Linux it matches nothing and is a pure no-op — keeping
  // the green non-Windows builds byte-for-byte unaffected.
  outputFileTracingExcludes: {
    '**/*': [
      '**/AppData/**',
      '**/Application Data/**',
      '**/Program Files/**',
      '**/Program Files (x86)/**',
      '**/Windows/**',
      '**/System32/**',
      '**/$Recycle.Bin/**',
    ],
  },
  serverExternalPackages: ["better-sqlite3"],
  images: {
    unoptimized: true
  },
  env: {},
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // better-sqlite3 is a native module the cursor auto-import route loads via a
    // best-effort runtime require() (with sqlite3-CLI + manual-paste fallbacks if
    // the bindings are absent — see oauth/cursor/auto-import/route.js). Mark it as
    // a server external so webpack emits `require("better-sqlite3")` verbatim and
    // never tries to resolve/bundle the native .node binary at build time, which
    // otherwise hard-fails with "Module not found: Can't resolve 'better-sqlite3'".
    // It's required from the standalone node_modules at runtime instead; the
    // serverExternalPackages entry above ensures it gets copied there. Applies on
    // every platform uniformly (the require is runtime-only everywhere).
    if (isServer) {
      const ext = { "better-sqlite3": "commonjs better-sqlite3" };
      if (Array.isArray(config.externals)) {
        config.externals.push(ext);
      } else if (config.externals) {
        config.externals = [config.externals, ext];
      } else {
        config.externals = [ext];
      }
    }
    // Windows EPERM fix: enhanced-resolve and Next.js's internal glob calls
    // walk parent directories looking for node_modules and hit Windows junction
    // points (e.g. 'Application Data' -> AppData\Roaming) which throw EPERM.
    // The EPERM leaves FlightClientEntryPlugin's module map incomplete, causing
    // createActionAssets to crash with 'Cannot read properties of undefined'.
    //
    // Two-pronged fix:
    // 1. symlinks:false — stop enhanced-resolve from following junction targets
    // 2. absolute modules path — stop the upward directory walk beyond router/
    config.resolve.symlinks = false;
    config.resolve.modules = [
      path.resolve(__dirname, 'node_modules'),
      'node_modules',
    ];
    // Prevent webpack from scanning problematic paths during watch mode
    config.watchOptions = { ...config.watchOptions, ignored: /[\\/](logs|\.next|node_modules|\.git)[\\/]/ };
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
