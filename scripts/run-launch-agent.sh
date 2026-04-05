#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${1:-claude}"
CONFIG="${2:-}"

cd "$REPO_DIR"

if [ -n "$CONFIG" ]; then
  echo "[launchd] repo=$REPO_DIR backend=$BACKEND config=$CONFIG"
  bun run check --backend "$BACKEND" --config "$CONFIG"
  exec bun run start --backend "$BACKEND" --config "$CONFIG"
else
  echo "[launchd] repo=$REPO_DIR backend=$BACKEND"
  bun run check --backend "$BACKEND"
  exec bun run start --backend "$BACKEND"
fi
