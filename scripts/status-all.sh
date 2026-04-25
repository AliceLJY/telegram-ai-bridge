#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="${PLIST_DIR:-$HOME/Library/LaunchAgents}"
EXTRA_URLS="${A2A_STATUS_URLS:-}"

resolve_config_path() {
  local config_path="$1"
  if [[ -z "$config_path" ]]; then
    printf '%s/config.json' "$REPO_DIR"
    return
  fi
  if [[ "$config_path" == /* ]]; then
    printf '%s' "$config_path"
    return
  fi
  printf '%s/%s' "$REPO_DIR" "$config_path"
}

json_get_args() {
  local plist="$1"
  plutil -convert json -o - "$plist" 2>/dev/null | bun -e '
    const data = JSON.parse(await Bun.stdin.text());
    console.log((data.ProgramArguments || []).join("\t"));
  '
}

config_port() {
  local config_path="$1"
  local backend="$2"
  bun -e '
    const config = JSON.parse(await Bun.file(process.argv[1]).text());
    const backend = process.argv[2];
    console.log(config.shared?.a2aPorts?.[backend] || "");
  ' "$config_path" "$backend"
}

status_line() {
  local name="$1"
  local url="$2"
  bun -e '
    const [name, url] = process.argv.slice(1);
    const pad = (value, width) => String(value).slice(0, width).padEnd(width, " ");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) {
        console.log(`${pad(name, 24)} ${pad("http-" + res.status, 10)} ${url}`);
        process.exit(0);
      }
      const body = await res.json();
      const peers = (body.peers || []).join(",") || "-";
      const received = body.loopGuard?.received ?? 0;
      const circuits = Object.entries(body.peerHealth || {})
        .map(([peer, state]) => `${peer}:${state.circuit}`)
        .join(",") || "-";
      console.log(`${pad(name, 24)} ${pad("ok", 10)} ${pad(peers, 18)} ${pad(received, 8)} ${pad(circuits, 24)} ${url}`);
    } catch (error) {
      console.log(`${pad(name, 24)} ${pad("down", 10)} ${pad("-", 18)} ${pad("-", 8)} ${pad("-", 24)} ${url}`);
    }
  ' "$name" "$url"
}

declare -a entries=()
if [[ -d "$PLIST_DIR" ]]; then
  shopt -s nullglob
  for plist in "$PLIST_DIR"/com.telegram-ai-bridge*.plist; do
    args="$(json_get_args "$plist" || true)"
    [[ -n "$args" ]] || continue
    IFS=$'\t' read -r _bash _script backend config_path <<< "$args"
    [[ -n "${backend:-}" ]] || continue
    config_path="$(resolve_config_path "${config_path:-}")"
    [[ -f "$config_path" ]] || continue
    port="$(config_port "$config_path" "$backend" || true)"
    [[ -n "$port" && "$port" != "0" ]] || continue
    name="$(basename "$plist" .plist)"
    entries+=("$name=http://127.0.0.1:$port/a2a/status")
  done
fi

if [[ -n "$EXTRA_URLS" ]]; then
  IFS=',' read -ra extra_entries <<< "$EXTRA_URLS"
  for entry in "${extra_entries[@]}"; do
    [[ -n "$entry" ]] && entries+=("$entry")
  done
fi

printf '%-24s %-10s %-18s %-8s %-24s %s\n' "NAME" "STATE" "PEERS" "RECEIVED" "CIRCUITS" "URL"
printf '%-24s %-10s %-18s %-8s %-24s %s\n' "----" "-----" "-----" "--------" "--------" "---"

if [[ ${#entries[@]} -eq 0 ]]; then
  echo "(no A2A status targets found)"
  exit 0
fi

for entry in "${entries[@]}"; do
  if [[ "$entry" == *=* ]]; then
    name="${entry%%=*}"
    url="${entry#*=}"
  else
    name="$entry"
    url="$entry"
  fi
  status_line "$name" "$url"
done
