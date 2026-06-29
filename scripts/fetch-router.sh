#!/bin/bash
# Stage the FreeSwarm Router (9router fork) for packaging.
# Usage: bash scripts/fetch-router.sh <dest_dir>
#
# FreeSwarm now uses its own fork of 9router (vendored in ./router, built to
# ./.next/standalone/router). This script copies the Next.js standalone build
# to the destination directory for inclusion in the final package.

set -euo pipefail

DEST="${1:-}"
if [[ -z "$DEST" ]]; then
    echo "Usage: $0 <dest_dir>" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
STANDALONE="$REPO_ROOT/router/.next/standalone"

# Next.js places the standalone app under a subdirectory matching the app's
# path relative to outputFileTracingRoot. With the tracing root pinned to
# router/ (see router/next.config.mjs, required to avoid the Windows EPERM
# scandir crash) the output is FLAT at .next/standalone/server.js. With the
# old inferred (monorepo) root it nested under .next/standalone/router/.
# Detect whichever layout the build produced so staging works either way.
echo "Staging FreeSwarm Router from fork..."

if [[ -f "$STANDALONE/router/server.js" ]]; then
    ROUTER_FORK="$STANDALONE/router"
elif [[ -f "$STANDALONE/server.js" ]]; then
    ROUTER_FORK="$STANDALONE"
else
    echo "ERROR: Router fork not built (no server.js in $STANDALONE or $STANDALONE/router). Run: cd $REPO_ROOT/router && npm run build" >&2
    exit 1
fi

mkdir -p "$DEST"
rsync -a --delete "$ROUTER_FORK/" "$DEST/"
echo "FreeSwarm Router staged at: $DEST (from $ROUTER_FORK)"
