#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${1:-$HOME/Library/Logs/telegram-ai-bridge}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TRASH_DIR="$HOME/.Trash/telegram-ai-bridge-log-rotation"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$LOG_DIR" "$TRASH_DIR"

shopt -s nullglob
for log in "$LOG_DIR"/*.log; do
  if [[ ! -s "$log" ]]; then
    continue
  fi
  archive="$log.$STAMP"
  cp "$log" "$archive"
  : > "$log"
  echo "rotated $log -> $archive"
done

find "$LOG_DIR" -type f -name '*.log.*' -mtime +"$RETENTION_DAYS" -print0 |
while IFS= read -r -d '' old_log; do
  target="$TRASH_DIR/$(basename "$old_log").$STAMP"
  mv "$old_log" "$target"
  echo "moved old archive to Trash: $target"
done
