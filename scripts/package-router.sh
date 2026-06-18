#!/bin/bash
set -euo pipefail

# Package the standalone FreeSwarm Router for distribution.
#
# Produces two kinds of artifact under electron-less router/dist-release/:
#   1. Per-platform self-contained bundles (zip for Windows, tar.gz otherwise)
#      that ship a bundled Node binary + a double-click start script. Users
#      extract and run start.sh / start.cmd; no system Node, no build step.
#   2. An npm-publishable payload (router/dist-release/npm/) with a bin
#      launcher, so `npx freeswarm-router` works for users who have Node.
#
# Both share one pure-JS payload: the Next.js standalone build with native
# optional modules (better-sqlite3, sharp) stripped. The router's primary
# datastore is lowdb (JSON), and images are unoptimized, so neither native
# module is needed at runtime — stripping them makes the payload portable
# across every OS/arch from a single build host. better-sqlite3 was only used
# by the Cursor token auto-import path, which already falls back to the sqlite3
# CLI / manual parsing when the native binding is absent.
#
# Usage:
#   bash scripts/package-router.sh                 # version from router/package.json
#   bash scripts/package-router.sh --version 1.0.0 # explicit version
#   bash scripts/package-router.sh --out /tmp/out  # custom output dir

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ROUTER_DIR="$PROJECT_ROOT/router"

NODE_VERSION="v20.18.1"
VERSION=""
OUT_DIR="$ROUTER_DIR/dist-release"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --out) OUT_DIR="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    VERSION="$(node -e "console.log(require('$ROUTER_DIR/package.json').version)")"
fi

echo "========================================"
echo "  FreeSwarm Router packager"
echo "  Version: $VERSION"
echo "  Output:  $OUT_DIR"
echo "========================================"
echo ""

# --- Step 1: Build the router (Next.js standalone) ---
echo "[1/5] Building router standalone..."
cd "$ROUTER_DIR"
npm ci
npm run build
STANDALONE="$ROUTER_DIR/.next/standalone/router"
if [[ ! -f "$STANDALONE/server.js" ]]; then
    echo "ERROR: standalone build missing ($STANDALONE/server.js)" >&2
    exit 1
fi
echo "Build complete."
echo ""

# --- Step 2: Assemble the shared pure-JS payload ---
# Next.js standalone omits .next/static and public from the traced output, so
# we copy them in by hand (this is the step the docs say to do manually). Then
# strip the native optional modules so the payload is OS/arch independent.
echo "[2/5] Assembling portable payload..."
PAYLOAD="$OUT_DIR/payload"
rm -rf "$OUT_DIR"
mkdir -p "$PAYLOAD"
rsync -a "$STANDALONE/" "$PAYLOAD/"
mkdir -p "$PAYLOAD/.next/static"
rsync -a "$ROUTER_DIR/.next/static/" "$PAYLOAD/.next/static/"
if [[ -d "$ROUTER_DIR/public" ]]; then
    mkdir -p "$PAYLOAD/public"
    rsync -a "$ROUTER_DIR/public/" "$PAYLOAD/public/"
fi
# Strip native optional modules (portability). Both have pure-JS fallbacks.
rm -rf "$PAYLOAD/node_modules/better-sqlite3" \
       "$PAYLOAD/node_modules/bindings" \
       "$PAYLOAD/node_modules/file-uri-to-path" \
       "$PAYLOAD/node_modules/@img" \
       "$PAYLOAD/node_modules/sharp" \
       "$PAYLOAD/node_modules/detect-libc"
echo "Payload assembled ($(du -sh "$PAYLOAD" | cut -f1))."
echo ""

# --- Step 3: Per-platform bundles with a bundled Node binary ---
echo "[3/5] Building per-platform bundles..."
BUNDLES_DIR="$OUT_DIR/bundles"
mkdir -p "$BUNDLES_DIR"

# unix start script (sh): set the router's conventional port + a per-user data
# dir, then exec the bundled node on server.js.
write_unix_start() {
    cat > "$1/start.sh" <<'EOF'
#!/bin/sh
# Launch FreeSwarm Router. Override PORT / HOSTNAME / DATA_DIR via env if needed.
DIR="$(cd "$(dirname "$0")" && pwd)"
export PORT="${PORT:-20128}"
export HOSTNAME="${HOSTNAME:-127.0.0.1}"
export NODE_ENV=production
export DATA_DIR="${DATA_DIR:-$HOME/.freeswarm-router}"
echo "FreeSwarm Router starting on http://$HOSTNAME:$PORT (data: $DATA_DIR)"
exec "$DIR/node" "$DIR/server.js"
EOF
    chmod +x "$1/start.sh"
}

write_win_start() {
    cat > "$1/start.cmd" <<'EOF'
@echo off
rem Launch FreeSwarm Router. Override PORT / HOSTNAME / DATA_DIR via env if needed.
setlocal
set "DIR=%~dp0"
if "%PORT%"=="" set "PORT=20128"
if "%HOSTNAME%"=="" set "HOSTNAME=127.0.0.1"
set "NODE_ENV=production"
if "%DATA_DIR%"=="" set "DATA_DIR=%USERPROFILE%\.freeswarm-router"
echo FreeSwarm Router starting on http://%HOSTNAME%:%PORT% (data: %DATA_DIR%)
"%DIR%node.exe" "%DIR%server.js"
EOF
}

write_readme() {
    cat > "$1/README.txt" <<EOF
FreeSwarm Router v$VERSION
==========================

A standalone LLM router / subscription proxy. Exposes an OpenAI-compatible API
on http://127.0.0.1:20128/v1 and a dashboard at http://127.0.0.1:20128.

To start:
  - Windows:        double-click start.cmd
  - macOS / Linux:  ./start.sh   (or: sh start.sh)

This bundle includes its own Node.js runtime, so you do NOT need Node installed.

Change the port or data directory with environment variables before launching:
  PORT=8080 DATA_DIR=/path/to/data ./start.sh

Data (accounts, providers, settings) is stored under ~/.freeswarm-router by
default. Uninstall by deleting this folder; remove that data dir too if you
want a clean wipe.

License: MIT (fork of 9router). See LICENSE inside the bundle.
EOF
}

# node download + bundle assembly per target.
#   $1 = label (linux-x64), $2 = node dist slug (linux-x64),
#   $3 = archive kind (tar|zip), $4 = node binary subpath in the dist tarball
build_bundle() {
    local label="$1" slug="$2" kind="$3"
    local name="freeswarm-router-v$VERSION-$label"
    local stage="$BUNDLES_DIR/$name"
    echo "  - $label"
    rm -rf "$stage"
    mkdir -p "$stage"
    rsync -a "$PAYLOAD/" "$stage/"
    [[ -f "$ROUTER_DIR/LICENSE" ]] && cp "$ROUTER_DIR/LICENSE" "$stage/LICENSE"
    write_readme "$stage"

    local tmp; tmp=$(mktemp -d)
    if [[ "$kind" == "zip" ]]; then
        curl -fsSL -o "$tmp/node.zip" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$slug.zip"
        ( cd "$tmp" && unzip -q node.zip )
        cp "$tmp/node-$NODE_VERSION-$slug/node.exe" "$stage/node.exe"
        write_win_start "$stage"
        ( cd "$BUNDLES_DIR" && zip -qr "$name.zip" "$name" )
        echo "    -> $name.zip"
    else
        curl -fsSL -o "$tmp/node.tar.gz" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$slug.tar.gz"
        tar xzf "$tmp/node.tar.gz" -C "$tmp"
        cp "$tmp/node-$NODE_VERSION-$slug/bin/node" "$stage/node"
        chmod +x "$stage/node"
        write_unix_start "$stage"
        ( cd "$BUNDLES_DIR" && tar czf "$name.tar.gz" "$name" )
        echo "    -> $name.tar.gz"
    fi
    rm -rf "$tmp" "$stage"
}

build_bundle "linux-x64"    "linux-x64"   "tar"
build_bundle "linux-arm64"  "linux-arm64" "tar"
build_bundle "macos-x64"    "darwin-x64"  "tar"
build_bundle "macos-arm64"  "darwin-arm64" "tar"
build_bundle "win-x64"      "win-x64"     "zip"
echo ""

# --- Step 4: npm-publishable payload ---
# Same portable payload + a bin launcher. No bundled node (npm users have it).
echo "[4/5] Preparing npm package..."
NPM_DIR="$OUT_DIR/npm"
rm -rf "$NPM_DIR"
mkdir -p "$NPM_DIR"
rsync -a "$PAYLOAD/" "$NPM_DIR/"
[[ -f "$ROUTER_DIR/LICENSE" ]] && cp "$ROUTER_DIR/LICENSE" "$NPM_DIR/LICENSE"
cat > "$NPM_DIR/bin.js" <<'EOF'
#!/usr/bin/env node
// FreeSwarm Router launcher for `npx freeswarm-router`. Sets the conventional
// port + data dir (overridable via env), then hands off to the Next.js
// standalone server, which chdir's to its own dir and serves :20128.
process.env.PORT = process.env.PORT || '20128';
process.env.HOSTNAME = process.env.HOSTNAME || '127.0.0.1';
process.env.NODE_ENV = 'production';
if (!process.env.DATA_DIR) {
  const os = require('os');
  const path = require('path');
  process.env.DATA_DIR = path.join(os.homedir(), '.freeswarm-router');
}
require('./server.js');
EOF
chmod +x "$NPM_DIR/bin.js"
# Publishable package.json. npm force-strips node_modules from a published
# tarball UNLESS each module is listed in BOTH dependencies and
# bundleDependencies, so we enumerate the traced standalone node_modules
# (next/react runtime; the app's own deps are webpack-inlined into .next) and
# declare them in both. Pinning to the exact traced versions keeps the
# published runtime identical to what built .next.
ROUTER_PKG="$ROUTER_DIR/package.json" \
NPM_DIR="$NPM_DIR" \
VERSION="$VERSION" \
node <<'NODE'
const fs = require("fs");
const path = require("path");
const npmDir = process.env.NPM_DIR;
const src = require(process.env.ROUTER_PKG);
const nmDir = path.join(npmDir, "node_modules");

// Enumerate top-level packages, expanding @scope dirs to their subpackages.
const names = [];
for (const entry of fs.readdirSync(nmDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (entry.name === ".bin") continue;
  if (entry.name.startsWith("@")) {
    for (const sub of fs.readdirSync(path.join(nmDir, entry.name), { withFileTypes: true })) {
      if (sub.isDirectory()) names.push(`${entry.name}/${sub.name}`);
    }
  } else {
    names.push(entry.name);
  }
}

const dependencies = {};
for (const name of names) {
  try {
    const v = require(path.join(nmDir, name, "package.json")).version;
    dependencies[name] = v;
  } catch (_) { /* skip a module without a readable package.json */ }
}

const pkg = {
  name: "freeswarm-router",
  version: process.env.VERSION,
  description: src.description,
  bin: { "freeswarm-router": "bin.js" },
  engines: { node: ">=18" },
  license: "MIT",
  repository: { type: "git", url: "https://github.com/yethikrishna/free-swarm.git", directory: "router" },
  dependencies,
  bundleDependencies: Object.keys(dependencies),
};
fs.writeFileSync(path.join(npmDir, "package.json"), JSON.stringify(pkg, null, 2));
console.log(`npm package.json: ${Object.keys(dependencies).length} bundled deps`);
NODE
echo "npm package staged at $NPM_DIR ($(du -sh "$NPM_DIR" | cut -f1))."
echo ""

# --- Step 5: Summary ---
echo "[5/5] Done."
rm -rf "$PAYLOAD"
echo ""
echo "Bundles:"
ls -lh "$BUNDLES_DIR"/*.tar.gz "$BUNDLES_DIR"/*.zip 2>/dev/null || true
echo ""
echo "npm package dir: $NPM_DIR"
echo "  Publish with:  (cd $NPM_DIR && npm publish --access public)"
