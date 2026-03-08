#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_PATH="$REPO_DIR/launchd/com.telegram-ai-bridge.plist.template"
RUNNER_PATH="$REPO_DIR/scripts/run-launch-agent.sh"

backend="claude"
label=""
plist_path=""
log_path=""
launch_path="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
install_now=false

usage() {
  cat <<'EOF'
Usage:
  ./scripts/install-launch-agent.sh [options]

Options:
  --backend <name>   claude | codex | gemini
  --label <label>    launchd label override
  --plist <path>     plist output path
  --log <path>       log file path
  --install          write plist and load it with launchctl
  --help             show this help
EOF
}

escape_replacement() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

default_label() {
  if [[ "$1" == "claude" ]]; then
    printf 'com.telegram-ai-bridge'
    return
  fi
  printf 'com.telegram-ai-bridge-%s' "$1"
}

default_log_path() {
  if [[ "$1" == "claude" ]]; then
    printf '%s/bridge.log' "$REPO_DIR"
    return
  fi
  printf '%s/bridge-%s.log' "$REPO_DIR" "$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)
      backend="${2:-}"
      shift 2
      ;;
    --label)
      label="${2:-}"
      shift 2
      ;;
    --plist)
      plist_path="${2:-}"
      shift 2
      ;;
    --log)
      log_path="${2:-}"
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

if [[ -n "${LAUNCH_AGENT_PATH:-}" ]]; then
  launch_path="$LAUNCH_AGENT_PATH"
else
  launch_path="$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
fi

case "$backend" in
  claude|codex|gemini)
    ;;
  *)
    echo "Unsupported backend: $backend" >&2
    exit 1
    ;;
esac

if [[ -z "$label" ]]; then
  label="$(default_label "$backend")"
fi
if [[ -z "$plist_path" ]]; then
  plist_path="$HOME/Library/LaunchAgents/$label.plist"
fi
if [[ -z "$log_path" ]]; then
  log_path="$(default_log_path "$backend")"
fi

mkdir -p "$(dirname "$plist_path")"
mkdir -p "$(dirname "$log_path")"

sed \
  -e "s/__LABEL__/$(escape_replacement "$label")/g" \
  -e "s/__WORKDIR__/$(escape_replacement "$REPO_DIR")/g" \
  -e "s/__SCRIPT__/$(escape_replacement "$RUNNER_PATH")/g" \
  -e "s/__BACKEND__/$(escape_replacement "$backend")/g" \
  -e "s/__PATH__/$(escape_replacement "$launch_path")/g" \
  -e "s/__LOG__/$(escape_replacement "$log_path")/g" \
  "$TEMPLATE_PATH" > "$plist_path"

plutil -lint "$plist_path" >/dev/null

echo "Wrote $plist_path"
echo "  label: $label"
echo "  backend: $backend"
echo "  log: $log_path"

if [[ "$install_now" != true ]]; then
  echo "Run again with --install to load it into launchd."
  exit 0
fi

domain="gui/$(id -u)"
launchctl bootout "$domain/$label" >/dev/null 2>&1 || true

if launchctl bootstrap "$domain" "$plist_path" >/dev/null 2>&1; then
  launchctl enable "$domain/$label" >/dev/null 2>&1 || true
  launchctl kickstart -k "$domain/$label" >/dev/null 2>&1 || true
  echo "Installed and started $label via bootstrap"
  exit 0
fi

echo "bootstrap failed, falling back to launchctl load/unload"
launchctl unload "$plist_path" >/dev/null 2>&1 || true
launchctl load "$plist_path"
launchctl kickstart -k "$domain/$label" >/dev/null 2>&1 || true

echo "Installed and started $label via load"
