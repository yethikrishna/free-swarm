/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Pin the file-tracing root to this directory. Otherwise Next.js infers the
  // workspace root from the nearest lockfile and, because the desktop build
  // checks out the router inside the monorepo (two package-lock.json files),
  // it walks UP into the parent. On Windows that upward scan reaches the
  // legacy `C:\Users\<user>\Application Data` junction, which throws
  // EPERM: scandir and crashes the standalone build. Pinning the root keeps
  // tracing inside router/ and silences the multi-lockfile warning.
  outputFileTracingRoot: import.meta.dirname,
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
    // Stop watching logs directory to prevent HMR during streaming
    config.watchOptions = { ...config.watchOptions, ignored: /[\\/](logs|\.next)[\\/]/ };
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
