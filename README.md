# telegram-ai-bridge

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/interface-Telegram-26A5E4.svg)](https://telegram.org/)

Turn Telegram into the remote control for your local AI coding agent.

`telegram-ai-bridge` lets you run one local AI CLI behind one Telegram bot, so you can continue coding conversations from your phone while the real agent stays on your machine.

![telegram-ai-bridge hero](assets/hero-bridge.svg)

Supported backends:

- `claude` → Claude Agent SDK, recommended
- `codex` → Codex SDK, recommended
- `gemini` → Gemini Code Assist API, experimental compatibility backend

Core product rule:

> One bot = one backend = one mental model.

This project is intentionally optimized for separate bots, not in-chat backend switching.

## Positioning

This project is deliberately not trying to become a multi-channel AI operations platform.

If you have seen products that combine Telegram, Feishu, web UI, multiple agents, dashboards, and team workflows, that is a different category.

`telegram-ai-bridge` is intentionally narrower:

| Dimension | `telegram-ai-bridge` | Multi-channel AI workspace tools |
| --- | --- | --- |
| Primary user | solo operator | team or org |
| Core goal | remotely continue a local coding session | coordinate many agents and channels |
| Interface | Telegram-first | Telegram + Feishu + Web UI + more |
| Runtime model | self-hosted, local CLI-first | platform / control-plane style |
| Complexity | thin bridge | broader product surface |
| Best for | personal remote control | team collaboration and operations |

That difference is a strength, not a limitation. This repo is optimized for people who want the shortest path from phone → Telegram → local AI CLI.

## Why This Exists

Most “Telegram + AI” projects are chat wrappers.

This one is different:

- it targets local coding agents instead of generic chatbots
- it keeps sessions on your machine instead of pretending to be a hosted SaaS
- it supports real resumable agent workflows
- it is designed for personal, owner-only remote control

If you already live in Claude Code or Codex and want a practical mobile control surface, this is the use case. Gemini is still supported, but no longer treated as a primary deployment path.

## Who It Is For

- solo builders who leave long-running coding sessions on a desktop or server
- AI power users who want to check progress and continue work from a phone
- people running separate Telegram bots for separate agents
- tinkerers who want a simple self-hosted bridge instead of a platform

## Choose This If

- you want to keep your real AI sessions on your own machine
- you prefer one bot per agent instead of one dashboard for everything
- you care more about speed and clarity than a large admin UI
- you want a personal tool, not a team collaboration suite

## What You Get

- one-command startup: `bun run start --backend <name>`
- interactive setup wizard: `bun run setup`
- `config.json` for portable configuration instead of scattered hardcoded paths
- SQLite-backed session persistence
- persistent task tracking for approvals and recent runs
- owner-only access model
- session listing, preview, resume, and model selection
- executor abstraction with `direct` and `local-agent` modes
- Docker entrypoint that follows the same runtime model
- legacy `.env*` fallback for older installs
- Gemini kept as an experimental compatibility backend instead of a primary path

## Quick Start

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
cp config.example.json config.json
bun run setup
bun run start --backend claude
```

If you prefer npm as a wrapper and already have Bun installed:

```bash
npm start -- --backend claude
```

## Recommended Deployment Model

Run separate bots for separate agents.

Examples:

- `@your-claude-bot` → Claude only
- `@your-codex-bot` → Codex only

Optional compatibility bot:

- `@your-gemini-bot` → Gemini only, if you explicitly need the compatibility backend

Why this model is better:

- users always know which agent they are talking to
- bot names, prompts, and expectations stay clean
- permissions and credentials are easier to reason about
- the README, setup, and support story stay simple

## 30-Second Mental Model

```text
Telegram bot
  -> start.js
  -> config.json
  -> bridge.js
  -> executor
  -> one backend adapter
  -> your local credentials and session files
```

Each bot instance keeps its own:

- Telegram bot token
- SQLite DB file
- task DB file
- local credential directory
- model/auth settings

## Setup

### Recommended: `config.json`

Create `config.json` in the repo root:

```bash
bun run setup
```

The wizard asks for:

- `OWNER_TELEGRAM_ID`
- shared working directory and optional proxy
- one Telegram bot token for each separately deployed bot
- backend-specific model / DB settings
- Gemini OAuth client settings only if you explicitly enable the compatibility backend

Use `config.example.json` as a starting point.

### Example Config

```json
{
  "shared": {
    "ownerTelegramId": "123456789",
    "cwd": "/Users/you",
    "httpProxy": "",
    "defaultVerboseLevel": 1,
    "executor": "direct",
    "tasksDb": "tasks.db"
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

`config.json` is gitignored so local secrets stay local.

### Legacy `.env` Fallback

If `config.json` does not exist, the CLI still supports:

- `claude` → `.env` or `.env.claude`
- `codex` → `.env.codex` + optional `.env`
- `gemini` → `.env.gemini` + optional `.env`

This is only for backward compatibility. New installs should use `config.json`.

## Run

Start one bot instance:

```bash
bun run start --backend claude
bun run start --backend codex
```

Optional compatibility mode:

```bash
bun run start --backend gemini
```

Helper scripts are thin wrappers around the same entrypoint:

```bash
./start-codex.sh
./start-gemini.sh
```

Inspect resolved runtime config:

```bash
bun run config --backend claude
```

Secrets are redacted in output.

## Telegram Commands

| Command | Description |
| --- | --- |
| `/new` | Start a new session |
| `/sessions` | List recent sessions |
| `/peek <id>` | Read-only preview a session |
| `/resume <id>` | Rebind the current chat to an owned session |
| `/model` | Pick a model for the current bot instance |
| `/status` | Show instance backend, model, cwd, and session |
| `/tasks` | Show recent task history for this chat |
| `/verbose 0|1|2` | Change progress verbosity |

## Execution Modes

- `direct` runs the backend adapter in-process and keeps today’s behavior
- `local-agent` talks to a local agent subprocess over JSONL stdio for a cleaner execution boundary

Set the mode in `config.json` with `shared.executor`, or override it with `BRIDGE_EXECUTOR`.

## Backend Notes

### Claude

- requires local Claude login/state under `~/.claude/`
- supports `permissionMode`: `default` or `bypassPermissions`

### Codex

- requires local Codex login/state under `~/.codex/`
- optional `model` override; empty string uses Codex defaults

### Gemini

- experimental compatibility backend, not a primary deployment target
- requires `~/.gemini/oauth_creds.json`
- requires `oauthClientId` and `oauthClientSecret`
- optional `googleCloudProject`
- uses Gemini Code Assist API mode, not full Gemini CLI terminal control
- recommended only when you intentionally need Gemini support; default product path is Claude/Codex

## Docker

Build:

```bash
docker build -t telegram-ai-bridge .
```

Run a Claude bot:

```bash
docker run -d \
  --name tg-ai-bridge-claude \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v ~/.claude:/root/.claude \
  telegram-ai-bridge --backend claude
```

Swap the mounted credential directory and `--backend` flag for `codex`. Use `gemini` only if you intentionally want the compatibility backend.

## Project Structure

- `start.js` — CLI entry for `start`, `setup`, and `config`
- `config.js` — config loader, setup wizard, legacy env compatibility
- `bridge.js` — Telegram bot runtime
- `sessions.js` — SQLite session persistence
- `adapters/` — backend integrations

## Roadmap

- [x] config-driven startup
- [x] one-command backend launch
- [x] interactive setup wizard
- [x] clearer user-facing README
- [ ] polished LaunchAgent examples
- [ ] deployment recipes for VPS / Docker / macOS
- [ ] better onboarding screenshots or demo GIF

## License

MIT
