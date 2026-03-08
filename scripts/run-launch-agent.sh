#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${1:-claude}"

cd "$REPO_DIR"

echo "[launchd] repo=$REPO_DIR backend=$BACKEND"
bun run check --backend "$BACKEND"
exec bun run start --backend "$BACKEND"
