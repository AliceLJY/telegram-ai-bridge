#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${1:-claude}"
CONFIG="${2:-}"

# Source ~/.proxy.env so launchd-spawned processes (e.g. codex Rust CLI) get HTTP_PROXY/HTTPS_PROXY.
# launchd does not read user shell rc files, so without this codex hits TLS handshake EOF on wss://chatgpt.com.
if [ -f "$HOME/.proxy.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$HOME/.proxy.env"
  set +a
fi

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
