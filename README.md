<div align="center">

# telegram-ai-bridge

**Remote Control Your Local AI Agent via Telegram**

*Leave Claude Code running on your desktop. Continue the conversation from your phone.*

A self-hosted Telegram bridge that connects one bot to one local AI CLI — with session persistence, resumable workflows, and owner-only access.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)

**English** | [简体中文](README_CN.md)

</div>

---

## Why This Exists

Most "Telegram + AI" projects are chat wrappers. This one is a **remote control** for your local coding agent.

- Targets local coding agents (Claude Code, Codex), not generic chatbots
- Sessions and credentials stay on your machine
- Supports real resumable agent workflows
- Owner-only access by default

> **Core product rule:** One bot = one backend = one mental model.

Supported backends:

| Backend | SDK | Status |
|---------|-----|--------|
| `claude` | Claude Agent SDK | Recommended |
| `codex` | Codex SDK | Recommended |
| `gemini` | Gemini Code Assist API | Experimental compatibility |

This project is intentionally narrower than multi-channel AI workspace tools. It optimizes for the shortest path from phone → Telegram → local AI CLI.

---

## Quick Start

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
bun run bootstrap --backend claude
bun run setup --backend claude
bun run check --backend claude
bun run start --backend claude
```

### Recommended Deployment

Run separate bots for separate agents:

- `@your-claude-bot` → Claude only
- `@your-codex-bot` → Codex only
- `@your-gemini-bot` → Gemini only (if you explicitly need it)

---

## What You Get

| Feature | Description |
|---------|-------------|
| **One-command startup** | `bun run start --backend <name>` |
| **Setup wizard** | `bun run setup` — interactive config generation |
| **Preflight check** | `bun run check --backend <name>` — validates config and CLI state |
| **Session persistence** | SQLite-backed, sticky sessions with resume/preview |
| **Task tracking** | Persistent approval and execution history |
| **Owner-only access** | Only your Telegram ID can use the bot |
| **Dual executor** | `direct` (in-process) or `local-agent` (JSONL stdio subprocess) |
| **Docker support** | Same runtime model, credential volumes mounted in |
| **macOS LaunchAgent** | Auto-generated plist for background deployment |
| **Group shared context** | Multiple bots in one group see each other's replies (SQLite / JSON / Redis) |
| **CI** | Bun tests wired into GitHub Actions |

---

## Telegram Commands

Sessions are sticky: messages continue the current session until you explicitly change it.

| Command | Description |
|---------|-------------|
| `/new` | Start a new session |
| `/sessions` | List recent sessions |
| `/peek <id>` | Read-only preview a session |
| `/resume <id>` | Rebind current chat to an owned session |
| `/model` | Pick a model for the current bot |
| `/status` | Show backend, model, cwd, and session |
| `/tasks` | Show recent task history |
| `/verbose 0\|1\|2` | Change progress verbosity |

---

## Multi-Bot Group Collaboration

Telegram bots cannot see each other's messages — this is a platform-level limitation. When you put Claude and Codex in the same group, neither can read the other's replies.

This project works around it with a **pluggable shared context store**. Each bot writes its reply after responding. When another bot is @mentioned, it reads the shared context and includes the other bot's replies in its prompt.

```text
You: @claude Review this code
CC:  [reviews code, writes reply to shared store]

You: @codex Do you agree with CC's review?
Codex: [reads CC's reply from shared store, gives opinion]
```

No copy-pasting needed. Built-in limits (30 messages / 3000 tokens / 20-minute TTL) prevent context bloat.

### Storage Backend Comparison

| Backend | Dependencies | Concurrency | Best For |
|---------|-------------|-------------|----------|
| `sqlite` (default) | None (built-in) | WAL mode, single-writer | Single bot, low concurrency |
| `json` | None (built-in) | Atomic write (tmp+rename) | Zero-dependency deployment |
| `redis` | `ioredis` | Native concurrency + TTL | Multi-bot, Docker environment |

Set `sharedContextBackend` in `config.json`:

```json
{
  "shared": {
    "sharedContextBackend": "redis",
    "redisUrl": "redis://localhost:6379"
  }
}
```

> **Note:** Bots only respond when explicitly @mentioned or replied to. They don't auto-reply to each other.

---

## Architecture

```text
Telegram bot
  → start.js
  → config.json
  → bridge.js
  → executor (direct | local-agent)
  → backend adapter (claude | codex | gemini)
  → local credentials and session files
```

Each bot instance keeps its own Telegram token, SQLite DBs, credential directory, and model settings.

---

<details>
<summary><strong>Configuration</strong></summary>

`bun run bootstrap --backend claude` generates a starter `config.json`. Or copy `config.example.json`.

```json
{
  "shared": {
    "ownerTelegramId": "123456789",
    "cwd": "/Users/you",
    "httpProxy": "",
    "defaultVerboseLevel": 1,
    "executor": "direct",
    "tasksDb": "tasks.db",
    "sharedContextBackend": "sqlite",
    "sharedContextDb": "shared-context.db",
    "redisUrl": ""
  },
  "backends": {
    "claude": {
      "enabled": true,
      "telegramBotToken": "...",
      "sessionsDb": "sessions.db",
      "model": "claude-sonnet-4-6",
      "permissionMode": "default"
    },
    "codex": {
      "enabled": true,
      "telegramBotToken": "...",
      "sessionsDb": "sessions-codex.db",
      "model": ""
    },
    "gemini": {
      "enabled": false,
      "telegramBotToken": "",
      "sessionsDb": "sessions-gemini.db",
      "model": "gemini-2.5-pro",
      "oauthClientId": "",
      "oauthClientSecret": "",
      "googleCloudProject": ""
    }
  }
}
```

`config.json` is gitignored. `shared.sessionTimeoutMs` controls per-request timeout only, not idle session expiry.

Inspect resolved config: `bun run config --backend claude` (secrets redacted).

</details>

<details>
<summary><strong>Backend Notes</strong></summary>

**Claude:**
- Requires local login state under `~/.claude/`
- Supports `permissionMode`: `default` or `bypassPermissions`

**Codex:**
- Requires local login state under `~/.codex/`
- Optional `model` override; empty string uses Codex defaults

**Gemini:**
- Experimental compatibility backend, not primary
- Requires `~/.gemini/oauth_creds.json`, `oauthClientId`, `oauthClientSecret`
- Uses Gemini Code Assist API mode, not full CLI terminal control
- Recommended only when you intentionally need Gemini support

</details>

<details>
<summary><strong>macOS LaunchAgent</strong></summary>

Generate and install:

```bash
./scripts/install-launch-agent.sh --backend claude --install
./scripts/install-launch-agent.sh --backend codex --install
```

The wrapper runs `bun run check` before `bun run start`, so bad config fails fast.

Default labels: `com.telegram-ai-bridge`, `com.telegram-ai-bridge-codex`, `com.telegram-ai-bridge-gemini`.

```bash
launchctl print gui/$(id -u)/com.telegram-ai-bridge
launchctl kickstart -k gui/$(id -u)/com.telegram-ai-bridge
tail -f bridge.log
```

If you see `409 Conflict`, another process is polling the same bot token.

</details>

<details>
<summary><strong>Docker</strong></summary>

```bash
docker build -t telegram-ai-bridge .

docker run -d \
  --name tg-ai-bridge-claude \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v ~/.claude:/root/.claude \
  telegram-ai-bridge --backend claude
```

Swap credential mount and `--backend` for other backends. See `docker-compose.example.yml` for a Compose starter.

</details>

<details>
<summary><strong>Project Structure</strong></summary>

- `start.js` — CLI entry for `start`, `bootstrap`, `check`, `setup`, `config`
- `config.js` — Config loader and setup wizard
- `bridge.js` — Telegram bot runtime
- `sessions.js` — SQLite session persistence
- `shared-context.js` — Cross-bot shared context entry point
- `shared-context/` — Pluggable backends (SQLite / JSON / Redis)
- `adapters/` — Backend integrations
- `launchd/` — LaunchAgent template for macOS
- `scripts/` — Install wrapper and runtime launcher
- `docker-compose.example.yml` — Compose starter

</details>

<details>
<summary><strong>Execution Modes</strong></summary>

- `direct` — runs the backend adapter in-process (default)
- `local-agent` — communicates with a local agent subprocess over JSONL stdio

Set in `config.json` at `shared.executor`, or override with `BRIDGE_EXECUTOR`.

</details>

---

## Development

```bash
bun test
```

GitHub Actions runs the same suite on every push and pull request.

## License

MIT
