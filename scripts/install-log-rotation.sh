#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_PATH="$REPO_DIR/launchd/com.telegram-ai-bridge-log-rotation.plist.template"
SCRIPT_PATH="$REPO_DIR/scripts/rotate-logs.sh"
LABEL="com.telegram-ai-bridge-log-rotation"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/telegram-ai-bridge"
install_now=false

usage() {
  cat <<'EOF'
Usage:
  ./scripts/install-log-rotation.sh [options]

Options:
  --log-dir <path>  log directory to rotate
  --plist <path>    plist output path
  --install         write plist and load it with launchctl
  --help            show this help
EOF
}

escape_replacement() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log-dir)
      LOG_DIR="${2:-}"
      shift 2
      ;;
    --plist)
      PLIST_PATH="${2:-}"
      shift 2
      ;;
    --install)
      install_now=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

mkdir -p "$(dirname "$PLIST_PATH")" "$LOG_DIR"
chmod +x "$SCRIPT_PATH"

sed \
  -e "s/__SCRIPT__/$(escape_replacement "$SCRIPT_PATH")/g" \
  -e "s/__LOG_DIR__/$(escape_replacement "$LOG_DIR")/g" \
  "$TEMPLATE_PATH" > "$PLIST_PATH"

if ! plutil -lint "$PLIST_PATH"; then
  echo "ERROR: generated plist failed plutil -lint at $PLIST_PATH" >&2
  exit 1
fi

echo "Wrote $PLIST_PATH"
echo "  log_dir: $LOG_DIR"
echo "  schedule: daily 03:00"

if [[ "$install_now" != true ]]; then
  echo "Run again with --install to load it into launchd."
  exit 0
fi

domain="gui/$(id -u)"
launchctl bootout "$domain/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$PLIST_PATH"
launchctl enable "$domain/$LABEL" >/dev/null 2>&1 || true
launchctl kickstart -k "$domain/$LABEL" >/dev/null 2>&1 || true
echo "Installed $LABEL"
