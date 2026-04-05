#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec bun run start --backend claude --config config-4.json "$@"
