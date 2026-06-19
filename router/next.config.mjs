import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: __dirname,
  // Windows EPERM fix: @vercel/nft walks parent directories looking for
  // dependencies and hits junction points that throw EPERM (e.g.,
  // C:\Users\runneradmin\Application Data). The outputFileTracingExcludes
  // patterns here are too late — glob tries to read the dir before the filter
  // applies. Instead, explicitly set where @vercel/nft can search by
  // restricting the module resolution. The webpack config's resolve.modules
  // already pins it to ./node_modules, but this ensures the file tracer
  // also respects that boundary.
  outputFileTracingExcludes: {
    '**/*': [
      // Exclude everything in Windows user/system directories that @vercel/nft
      // might try to scan if a path resolves there (catches junction errors early)
      '**/AppData/**',
      '**/Application Data/**',
      '**/Program Files/**',
      '**/Program Files (x86)/**',
      '**/Windows/**',
      '**/System32/**',
      '**/$Recycle.Bin/**',
      // Exclude temp dirs
      '**/Temp/**',
      '**/tmp/**',
      // Don't follow .git or other build artifacts
      '**/.git/**',
      '**/.next/static/**',
      '**/.next/cache/**',
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
