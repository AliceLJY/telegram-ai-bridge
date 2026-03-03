#!/bin/bash
# 启动 Codex 实例（单独 bot token + 单独 sessions DB）
cd /Users/USER/Projects/telegram-ai-bridge
set -a
source .env.codex
set +a
exec /Users/USER/.bun/bin/bun bridge.js
