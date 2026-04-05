<div align="center">

# telegram-ai-bridge

**Your AI Agents, Fully Managed from Telegram**

*Run 4 parallel Claude Code sessions from your phone. Shared memory, independent contexts, zero configuration drift.*

A self-hosted Telegram bridge that turns your phone into a multi-window AI terminal — with full session control over Claude Code, Codex, and Gemini.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)

**English** | [简体中文](README_CN.md)

</div>

---

## Why Not Just Use Claude's Built-in Remote Features?

Claude Code now ships [Remote Control](https://code.claude.com/docs/en/remote-control) (Feb 2026) and a [Telegram channel plugin](https://code.claude.com/docs/en/channels) (Mar 2026). Both let you talk to Claude from your phone. Neither gives you session management, multi-backend support, or agent-to-agent collaboration.

| What you'd expect from phone control | [Remote Control](https://code.claude.com/docs/en/remote-control) | [Channels](https://code.claude.com/docs/en/channels) (TG plugin) | [OpenClaw](https://github.com/openclaw/openclaw) | This project |
|---------------------------------------|:-:|:-:|:-:|:-:|
| Parallel sessions (multi-instance)    | &mdash; | &mdash; | 1 bot = 1 session | **N bots, N parallel CC instances, shared memory** |
| Create new sessions from phone        | &mdash; | &mdash; | &mdash; | `/new` |
| Browse & resume past sessions         | &mdash; | &mdash; | &mdash; | `/sessions` `/resume` `/peek` |
| Switch models on the fly              | &mdash; | &mdash; | Per-bot config | `/model` with inline buttons |
| Claude + Codex + Gemini backends      | Claude only | Claude only | Provider-locked | All three, per-chat switchable |
| Tool approval from phone              | Partial (limited UI) | Yes | Yes | Inline buttons: Allow / Deny / Always / YOLO |
| War Room (multi-agent command center) | &mdash; | &mdash; | &mdash; | @mention dispatch + Redis shared context |
| Multi-agent group collaboration       | &mdash; | &mdash; | &mdash; | A2A bus + shared context |
| Cross-agent collaboration             | &mdash; | &mdash; | Gateway channels | A2A broadcast (groups) + MCP/CLI (DMs) |
| Real-time progress streaming          | Terminal output only | &mdash; | Yes | Tool icons + 3 verbosity levels + summary |
| Rapid message batching                | N/A | &mdash; | &mdash; | FlushGate: 800ms window, auto-merge |
| Photo / document / voice input        | &mdash; | Text only | Yes | Auto-download + reference in prompt |
| Smart quick-reply buttons             | &mdash; | &mdash; | &mdash; | Yes/No + numbered options (1. 1、 1) formats) |
| Runs as background daemon             | Terminal must stay open | Session must be open | Yes (Gateway) | LaunchAgent / Docker |
| Survives network interruptions        | 10-min timeout kills session | Tied to session lifecycle | Gateway reconnect | SQLite + Redis persistence |
| Memory shared across instances        | N/A | N/A | Per-bot isolated | **All instances share CLAUDE.md + MCP memory** |
| Per-bot persona                       | N/A | N/A | SOUL.md per bot | Per-bot `CLAUDE.md` workspace + shared global rules |
| Group context compression             | N/A | N/A | N/A | 3-tier: recent full / middle truncated / old keywords |
| Shared context backend                | N/A | N/A | N/A | SQLite / JSON / Redis (pluggable) |
| Task audit trail                      | &mdash; | &mdash; | &mdash; | SQLite: status, cost, duration, approval log |
| Loop guard for bot-to-bot             | N/A | N/A | N/A | 5-layer: generation + cooldown + rate + dedup + AI |
| Stable release                        | Yes | Research preview | Yes | Yes (v2.2) |

**What official tools do better:** Remote Control streams full terminal output. Channels relay tool-approval dialogs natively. Claude Code on the web provides cloud compute without local setup. This project optimizes for a different job: **persistent, multi-agent session management entirely from Telegram.**

> **How they differ:** Remote Control = your phone *watches* the terminal. Channels = the terminal *receives* phone messages. This project = your phone **IS** the terminal.

Supported backends:

| Backend | SDK | Status |
|---------|-----|--------|
| `claude` | Claude Code (via Agent SDK) | Recommended |
| `codex` | Codex CLI (via Codex SDK) | Recommended |
| `gemini` | Gemini Code Assist API | Experimental |

> **Core rule:** One bot = one process = one independent agent. Run as many as you need.

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

Run multiple bots for parallel workflows:

- `@cc-alpha` → Claude Code instance 1 (primary)
- `@cc-beta` → Claude Code instance 2 (parallel tasks)
- `@cc-gamma` → Claude Code instance 3 (parallel tasks)
- `@your-codex-bot` → Codex (different backend)

Each Claude instance shares memory automatically. No configuration needed — CC's memory lives in `~/.claude/`, not in the bot.

---

## What This Unlocks

### Parallel Sessions — Your Phone is a Multi-Window Terminal

On your desktop you run 4-5 Claude Code windows simultaneously. Now do the same from your phone:

```
TG Bot 1 (🟣) ──→ CC Instance 1 ──┐
TG Bot 2 (🔵) ──→ CC Instance 2 ──┤── Shared: CLAUDE.md + MCP memory + ~/.claude/
TG Bot 3 (🟢) ──→ CC Instance 3 ──┤
TG Bot 4 (🟡) ──→ CC Instance 4 ──┘
```

Each bot runs an independent CC process with its own session. All instances share the same memory layer (CLAUDE.md, RecallNest, project settings) — what you tell one, the others already know. No memory fragmentation, no sync overhead.

Setup takes 30 seconds per instance: create a bot with @BotFather, copy a config, start a process. See [Multi-Instance Deployment](#multi-instance-deployment) below.

**Want different personalities?** Point each bot's `cwd` to a directory with its own `CLAUDE.md`. CC loads global rules from `~/.claude/CLAUDE.md` + per-bot persona from the workspace — just like OpenClaw's SOUL.md, but with CC's full skill/hook/MCP stack behind it.

```
~/.claude/CLAUDE.md              ← shared rules (memory, safety, workflow)
~/bots/researcher/CLAUDE.md      ← "You are a deep research analyst..."
~/bots/reviewer/CLAUDE.md        ← "You are a senior code reviewer..."
~/bots/writer/CLAUDE.md          ← "You are a content strategist..."
```

> **Why this matters:** OpenClaw gives you one bot = one session, isolated memory. Claude's official tools give you one session, period. This project gives you N parallel sessions with shared memory and optional per-bot personas — the same workflow that makes desktop CC productive, now on your phone.

### Phone-First Agent Control

Walk away from your desk. Open Telegram. `/new` starts a fresh session. `/resume 3` picks up where you left off. `/peek 5` reads a session without touching it. `/model` switches models on the fly. Full session lifecycle from your phone — no terminal required.

### Multi-Agent Collaboration

Put `@claude-bot` and `@codex-bot` in the same Telegram group. Ask Claude to review code — Codex reads the reply via shared context and offers its own take automatically. Built-in loop guards and circuit breakers prevent runaway bot-to-bot conversations. For DM cross-checking, bots communicate directly via MCP/CLI — no relay needed.

### War Room — Multi-CC Command Center

Put all 4 CC bots in one Telegram group. Each bot stays silent until @mentioned — no crosstalk, no chaos. But every bot can read what the others said via shared context (Redis-backed). You orchestrate:

```
You:      @cc-alpha Analyze this API design
Alpha:    [deep analysis, writes to shared context]

You:      @cc-beta Write integration tests based on Alpha's analysis
Beta:     [reads Alpha's analysis from shared context, writes tests]

You:      @cc-gamma Review both — any gaps?
Gamma:    [reads everything, reviews]

You:      @cc-delta Ship it — commit and push
Delta:    [reads full context, commits]
```

**4 agents, 1 group, shared memory, zero noise.** Each bot only speaks when called. All context flows through Redis — no copy-pasting, no re-explaining. This is how a human manages a team: delegate, review, ship.

Two collaboration modes in one project:
- **A2A mode** (CC + Codex group): bots auto-respond to each other with loop guards — for brainstorming and debate
- **War Room mode** (multi-CC group): @mention only — for coordinated parallel execution

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

## Multi-Instance Deployment

Run N parallel Claude Code instances, each with its own Telegram bot:

**1. Create a bot** — message @BotFather on Telegram, get a token.

**2. Create a config file** — copy and customize:

```bash
cp config.json config-2.json
# Edit config-2.json: change telegramBotToken, sessionsDb, tasksDb
```

```json
{
  "shared": {
    "ownerTelegramId": "YOUR_ID",
    "tasksDb": "tasks-2.db"
  },
  "backends": {
    "claude": {
      "enabled": true,
      "telegramBotToken": "NEW_TOKEN_FROM_BOTFATHER",
      "sessionsDb": "sessions-2.db",
      "model": "claude-opus-4-6",
      "permissionMode": "bypassPermissions"
    }
  }
}
```

**3. Start it:**

```bash
bun run start --backend claude --config config-2.json
```

**4. (Optional) Register as LaunchAgent** for auto-start:

```bash
# The run script accepts an optional config path as second argument:
# scripts/run-launch-agent.sh <backend> [config-file]
```

See the LaunchAgent section below for plist setup.

> **What's shared vs isolated:**
>
> | Shared (automatic) | Isolated (per-instance) |
> |---|---|
> | `~/.claude/` (CLAUDE.md, memory, skills, hooks) | Telegram bot token |
> | MCP servers (RecallNest, etc.) | SQLite sessions DB |
> | Project settings & rules | SQLite tasks DB |
> | Git repos & file system | Log files |

---

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
