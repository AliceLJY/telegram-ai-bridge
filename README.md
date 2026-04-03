<div align="center">

# telegram-ai-bridge

**Your AI Agents, Fully Managed from Telegram**

*Create sessions, browse history, switch models, orchestrate multi-agent workflows — all from your phone.*

A self-hosted Telegram bridge that gives you full session control over local AI coding agents — Claude Code, Codex, and Gemini.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)

**English** | [简体中文](README_CN.md)

</div>

---

## Why Not Just Use Claude's Built-in Remote Features?

Claude Code now ships [Remote Control](https://code.claude.com/docs/en/remote-control) (Feb 2026) and a [Telegram channel plugin](https://code.claude.com/docs/en/channels) (Mar 2026). Both let you talk to Claude from your phone. Neither gives you session management, multi-backend support, or agent-to-agent collaboration.

| What you'd expect from phone control | [Remote Control](https://code.claude.com/docs/en/remote-control) | [Channels](https://code.claude.com/docs/en/channels) (TG plugin) | This project |
|---------------------------------------|:-:|:-:|:-:|
| Create new sessions from phone        | &mdash; | &mdash; | `/new` |
| Browse & resume past sessions         | &mdash; | &mdash; | `/sessions` `/resume` `/peek` |
| Switch models on the fly              | &mdash; | &mdash; | `/model` with inline buttons |
| Claude + Codex + Gemini backends      | Claude only | Claude only | All three, per-chat switchable |
| Tool approval from phone              | Partial (limited UI) | Yes | Inline buttons: Allow / Deny / Always / YOLO |
| Multi-agent group collaboration       | &mdash; | &mdash; | A2A bus + shared context |
| Cross-agent collaboration             | &mdash; | &mdash; | A2A broadcast (groups) + MCP/CLI (DMs) |
| Real-time progress streaming          | Terminal output only | &mdash; | Tool icons + 3 verbosity levels + summary |
| Rapid message batching                | N/A | &mdash; | FlushGate: 800ms window, auto-merge |
| Photo / document / voice input        | &mdash; | Text only | Auto-download + reference in prompt |
| Smart quick-reply buttons             | &mdash; | &mdash; | Yes/No + numbered options (1. 1、 1) formats) |
| Runs as background daemon             | Terminal must stay open | Session must be open | LaunchAgent / Docker |
| Survives network interruptions        | 10-min timeout kills session | Tied to session lifecycle | SQLite + Redis persistence |
| Group context compression             | N/A | N/A | 3-tier: recent full / middle truncated / old keywords |
| Shared context backend                | N/A | N/A | SQLite / JSON / Redis (pluggable) |
| Task audit trail                      | &mdash; | &mdash; | SQLite: status, cost, duration, approval log |
| Loop guard for bot-to-bot             | N/A | N/A | 5-layer: generation + cooldown + rate + dedup + AI |
| Stable release                        | Yes | Research preview | Yes (v2.2) |

**What official tools do better:** Remote Control streams full terminal output. Channels relay tool-approval dialogs natively. Claude Code on the web provides cloud compute without local setup. This project optimizes for a different job: **persistent, multi-agent session management entirely from Telegram.**

> **How they differ:** Remote Control = your phone *watches* the terminal. Channels = the terminal *receives* phone messages. This project = your phone **IS** the terminal.

Supported backends:

| Backend | SDK | Status |
|---------|-----|--------|
| `claude` | Claude Agent SDK | Recommended |
| `codex` | Codex SDK | Recommended |
| `gemini` | Gemini Code Assist API | Experimental |

> **Core rule:** One bot = one backend = one mental model.

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

## What This Unlocks

### Phone-First Agent Control

Walk away from your desk. Open Telegram. `/new` starts a fresh session. `/resume 3` picks up where you left off. `/peek 5` reads a session without touching it. `/model` switches models on the fly. Full session lifecycle from your phone — no terminal required.

### Multi-Agent Collaboration

Put `@claude-bot` and `@codex-bot` in the same Telegram group. Ask Claude to review code — Codex reads the reply via shared context and offers its own take automatically. Built-in loop guards and circuit breakers prevent runaway bot-to-bot conversations. For DM cross-checking, bots communicate directly via MCP/CLI — no relay needed.

### Always-On, Self-Hosted

macOS LaunchAgent or Docker keeps the bridge running in the background. Sessions persist in SQLite across restarts and reboots. Code and credentials never leave your machine. Owner-only access by default.

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
| `/a2a status` | Show A2A bus status, peer health, and loop guard stats |

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

### A2A: Agent-to-Agent Communication

Beyond passive shared context, A2A lets bots **actively respond** to each other in group chats. When one bot replies to a user, the A2A bus broadcasts the response to sibling bots. Each sibling independently decides whether to chime in.

```text
You:    @claude What's the best way to handle retries?
Claude: [responds with retry pattern advice]
         ↓ A2A broadcast
Codex:  [reads Claude's reply, adds: "I'd also suggest exponential backoff..."]
```

Built-in safety:
- **Loop guard**: Max 2 generations of bot-to-bot replies per conversation turn
- **Cooldown**: 60s minimum between A2A responses per bot
- **Circuit breaker**: Auto-disables unreachable peers after 3 failures
- **Rate limit**: Max 3 A2A responses per 5-minute window

> **Important:** A2A only works in group chats. Private/DM conversations are never broadcast — this prevents cross-bot message leaking between separate DM windows.

Enable in `config.json`:

```json
{
  "shared": {
    "a2aEnabled": true,
    "a2aPorts": { "claude": 18810, "codex": 18811 }
  }
}
```

Each bot instance listens on its assigned port. Peers are auto-discovered from `a2aPorts` (excluding self).

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

`config.json` is gitignored. Sessions run until completion — no hard timeout (a soft watchdog logs after 15 minutes without aborting).

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
- `a2a/` — Agent-to-agent communication bus, loop guard, peer health
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

## How It Fits Together

Three ways to make AI agents talk to each other — different protocols, different scenarios:

| Layer | Protocol | How | Scenario |
|-------|----------|-----|----------|
| **Terminal** | MCP | Built-in `codex mcp-server` + `claude mcp serve`, zero code | CC ↔ Codex direct calls in your terminal |
| **Telegram Group** | Custom A2A | This project's A2A bus, auto-broadcast | Multiple bots in one group, chiming in |
| **Telegram DM** | MCP / CLI | Bots call each other directly via terminal config | Direct cross-bot communication, no bridge needed |
| **Server** | Google A2A v0.3.0 | [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) | OpenClaw agents across servers |

> **MCP vs A2A**: MCP is a tool-calling protocol (I invoke your capability). A2A is a peer communication protocol (I talk to you as an equal). CC calling Codex via MCP is using Codex as a tool — not two agents chatting.

### Terminal: CLI-to-CLI via MCP (No Telegram Needed)

Claude Code and Codex each have a built-in MCP server mode. Register them with each other and they can call each other directly — no bridge, no Telegram, no custom code:

```bash
# In Claude Code: register Codex as MCP server
claude mcp add codex -- codex mcp-server

# In Codex: register Claude Code as MCP server (in ~/.codex/config.toml)
[mcp_servers.claude-code]
type = "stdio"
command = "claude"
args = ["mcp", "serve"]
```

### Telegram: This Project

Groups use A2A auto-broadcast. DMs go through MCP/CLI direct communication. See sections above.

### Server: openclaw-a2a-gateway

For OpenClaw agents communicating across servers via the Google A2A v0.3.0 standard protocol. A different system entirely — see [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway).

## Development

```bash
bun test
```

GitHub Actions runs the same suite on every push and pull request.

## Ecosystem

Part of the **小试AI** open-source AI workflow:

| Project | Description |
|---------|-------------|
| [recallnest](https://github.com/AliceLJY/recallnest) | MCP memory workbench (LanceDB + Jina v5) |
| [content-alchemy](https://github.com/AliceLJY/content-alchemy) | 5-stage AI writing pipeline |
| [content-publisher](https://github.com/AliceLJY/content-publisher) | Image generation + layout + WeChat publishing |
| [openclaw-tunnel](https://github.com/AliceLJY/openclaw-tunnel) | Docker ↔ host CLI bridge (/cc /codex /gemini) |
| [digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill) | Build digital clones from corpus data |
| [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge) | Telegram CLI bridge for Gemini CLI |
| [claude-code-studio](https://github.com/AliceLJY/claude-code-studio) | Multi-session collaboration platform for Claude Code |
| [agent-nexus](https://github.com/AliceLJY/agent-nexus) | One-command installer for memory + remote control |
| [cc-cabin](https://github.com/AliceLJY/cc-cabin) | Complete Claude Code workflow scaffold |

## License

MIT
