#!/bin/bash
# 启动 Gemini 实例（单独 bot token + 单独 sessions DB）
cd /Users/anxianjingya/Projects/telegram-ai-bridge
set -a
source .env.gemini
set +a
exec /Users/anxianjingya/.bun/bin/bun bridge.js
