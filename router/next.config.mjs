import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  outputFileTracingIgnores: [
    '**/{Application Data,AppData,TEMP,Temp,Downloads}/**',
    '**/{Application Data,AppData,TEMP,Temp,Downloads}',
    '**/.cache',
    '**/.npm',
    '**/{node_modules,\.next,\.git}',
  ],
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
    // Three-pronged fix:
    // 1. symlinks:false — stop enhanced-resolve from following junction targets
    // 2. absolute modules path — stop the upward directory walk beyond router/
    // 3. aliasFields=[] — prevent resolving package.json exports that redirect
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
