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
ROUTER_FORK="$REPO_ROOT/router/.next/standalone/router"

echo "Staging FreeSwarm Router from fork..."

if [[ ! -d "$ROUTER_FORK" ]]; then
    echo "ERROR: Router fork not built. Run: cd $REPO_ROOT/router && npm run build" >&2
    exit 1
fi

mkdir -p "$DEST"
rsync -a --delete "$ROUTER_FORK/" "$DEST/"
echo "FreeSwarm Router staged at: $DEST (from $ROUTER_FORK)"
