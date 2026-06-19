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
