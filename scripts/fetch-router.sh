#!/bin/bash
# Fetch the pre-built 9router Next.js app from npm and stage it for packaging.
# Usage: bash scripts/fetch-router.sh <dest_dir>
#
# NOTE: the FreeSwarm Router fork source lives in ../router (see
# router/FREESWARM_FORK.md). The runtime still uses the pinned npm build below
# until that fork is built and validated against backend providers/registry.py;
# do not repoint this script at the fork without doing that validation first.

set -euo pipefail

DEST="${1:-}"
if [[ -z "$DEST" ]]; then
    echo "Usage: $0 <dest_dir>" >&2
    exit 1
fi

ROUTER_VERSION="${ROUTER_VERSION:-0.3.60}"

echo "Fetching 9router@${ROUTER_VERSION} from npm..."

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

cd "$SCRATCH"
printf '{"name":"_fetch","version":"0.0.0","private":true}\n' > package.json
npm install "9router@${ROUTER_VERSION}" --no-save --no-audit --no-fund --silent --ignore-scripts

SRC="$SCRATCH/node_modules/9router/app"
if [[ ! -d "$SRC" ]]; then
    echo "ERROR: 9router@${ROUTER_VERSION} did not install to expected layout ($SRC missing)" >&2
    exit 1
fi

mkdir -p "$DEST"
rsync -a --delete "$SRC/" "$DEST/"
echo "9router staged at: $DEST"
