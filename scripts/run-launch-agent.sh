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

# --- 等 Redis 就绪再启动（开机竞态根治，2026-06-24）---------------------------
# 现象：开机时 docker/redis 容器常比本 launchd 服务晚就绪，bridge 抢先跑 check 时
#   Redis ping 扑空 → check exit 1 → 靠 KeepAlive 重启才自愈，每次开机日志先记一条 failed。
# 处理：check 前先探 Redis 端口就绪（最多 ~60s）。探通再 check，通常一次过；万一 60s
#   还没起，仍走下面的 check（失败则 set -e 退出、KeepAlive 兜底），不改变最终语义。
# Redis = 本机 docker 容器（compose 映射 6379）。sqlite/json 配置不需要等，避免无 Redis 时每次重启白等 60s。
SHOULD_WAIT_REDIS=1
if [ -n "$CONFIG" ] && [ -f "$CONFIG" ]; then
  if grep -Eq '"sharedContextBackend"[[:space:]]*:[[:space:]]*"redis"|"redisUrl"[[:space:]]*:[[:space:]]*"[^"]+' "$CONFIG"; then
    SHOULD_WAIT_REDIS=1
  else
    SHOULD_WAIT_REDIS=0
  fi
fi

if [ "$SHOULD_WAIT_REDIS" = "1" ]; then
  REDIS_PROBE_HOST=127.0.0.1
  REDIS_PROBE_PORT=6379
  for i in $(seq 1 30); do
    if nc -z "$REDIS_PROBE_HOST" "$REDIS_PROBE_PORT" 2>/dev/null; then
      echo "[launchd] redis ${REDIS_PROBE_HOST}:${REDIS_PROBE_PORT} ready (attempt ${i})"
      break
    fi
    echo "[launchd] waiting for redis ${REDIS_PROBE_HOST}:${REDIS_PROBE_PORT} (attempt ${i}/30)"
    sleep 2
  done
else
  echo "[launchd] redis wait skipped (shared context is not redis)"
fi
# -----------------------------------------------------------------------------

if [ -n "$CONFIG" ]; then
  echo "[launchd] repo=$REPO_DIR backend=$BACKEND config=$CONFIG"
  bun run check --backend "$BACKEND" --config "$CONFIG"
  exec bun run start --backend "$BACKEND" --config "$CONFIG"
else
  echo "[launchd] repo=$REPO_DIR backend=$BACKEND"
  bun run check --backend "$BACKEND"
  exec bun run start --backend "$BACKEND"
fi
