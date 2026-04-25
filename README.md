<div align="center">

# telegram-ai-bridge

**Heterogeneous AI agents talking to each other in a Telegram group — with real loop-suppression, not just "put two bots in a chat."**

*Claude Code, Codex, and Gemini as independent full-stack bots, coordinated over a Telegram-native envelope protocol (A2A-TG) with generation-counted loop guards. Always-on, self-hosted, owner-gated.*

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-4.1.0-green.svg)](https://github.com/AliceLJY/telegram-ai-bridge/releases)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)
[![A2A-TG spec](https://img.shields.io/badge/A2A--TG-v1-8a2be2)](docs/a2a-tg-v1.md)
[![GitHub stars](https://img.shields.io/github/stars/AliceLJY/telegram-ai-bridge)](https://github.com/AliceLJY/telegram-ai-bridge)

**English** | [简体中文](README_CN.md)

</div>

> **On the A2A name.** The [A2A protocol](https://a2a-protocol.org) was originally proposed by Google and is now a Linux Foundation project. This repository ships **A2A-TG** — an IM-scenario envelope inspired by A2A with generation-based loop suppression and chat-scoped idempotency. A2A-TG is **not** compatible with official A2A and is not affiliated with the official project. See the [A2A-TG v1 spec](docs/a2a-tg-v1.md).

> Remote Control = your phone *watches* the terminal.
> Channels = the terminal *receives* phone messages.
> **This project = heterogeneous agents collaborating in a group chat, and the chat IS the terminal.**

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

**4 agents, 1 group, shared memory, zero noise.** The same workflow that takes 4 terminal windows on your desk — now fits in your pocket.

<img src="assets/war-room-demo.png" alt="War Room — 4 CC bots processing in parallel" width="600">

---

## Pick your path

Four different jobs this project does. Each entry point is independent — you do not need to read the whole README to use one mode.

| If you want to…                                                        | Start here                                         | Core tech                         |
|------------------------------------------------------------------------|----------------------------------------------------|-----------------------------------|
| **Control one Claude Code from your phone**                            | [Quick Start](#quick-start)                        | Single bot, Agent SDK             |
| **Run N parallel Claude sessions with shared memory (War Room)**       | [Parallel Sessions](#parallel-sessions--desktop-power-phone-form-factor) → [Multi-Instance Deployment](#multi-instance-deployment) | @mention dispatch + Redis shared context |
| **Let Claude and Codex actively talk to each other in a group**        | [A2A-TG: Heterogeneous agents in one group chat](#a2a-tg-heterogeneous-agents-in-one-group-chat) | A2A-TG envelope + 5-layer loop guard |
| **Read the protocol / embed A2A-TG in your own bot**                   | [A2A-TG v1 spec](docs/a2a-tg-v1.md)                | HTTP/JSON envelope, generation cap |

---

## What This Unlocks

### Parallel Sessions — Desktop Power, Phone Form Factor

On your desktop you run 4-5 Claude Code windows simultaneously. Now do the same from your phone:

```
TG Bot 1 (🟣) ──→ CC Instance 1 ──┐
TG Bot 2 (🔵) ──→ CC Instance 2 ──┤── Shared: CLAUDE.md + MCP memory + ~/.claude/
TG Bot 3 (🟢) ──→ CC Instance 3 ──┤
TG Bot 4 (🟡) ──→ CC Instance 4 ──┘
```

Each bot runs an independent CC process with its own session. Not a thin API client — **full Claude Code** with all native tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch), skills, hooks, and MCP servers. All instances share the same memory layer (CLAUDE.md, RecallNest, project settings) — what you tell one, the others already know. No memory fragmentation, no sync overhead.

Setup takes 30 seconds per instance: create a bot with @BotFather, copy a config, start a process. See [Multi-Instance Deployment](#multi-instance-deployment) below.

**Want different personalities?** Point each bot's `cwd` to a directory with its own `CLAUDE.md`. CC loads global rules from `~/.claude/CLAUDE.md` + per-bot persona from the workspace — just like OpenClaw's SOUL.md, but with CC's full skill/hook/MCP stack behind it.

```
~/.claude/CLAUDE.md              ← shared rules (memory, safety, workflow)
~/bots/researcher/CLAUDE.md      ← "You are a deep research analyst..."
~/bots/reviewer/CLAUDE.md        ← "You are a senior code reviewer..."
~/bots/writer/CLAUDE.md          ← "You are a content strategist..."
```

### Phone-First Agent Control

Walk away from your desk. Open Telegram. `/new` starts a fresh session. `/resume 3` picks up where you left off. `/peek 5` reads a session without touching it. `/model` switches models on the fly. Full session lifecycle from your phone — no terminal required.

The session picker shows **the last thing you said** as the title — not a truncated UUID. Tap a button or type `/resume 3`. Sessions from all sources (this bot, terminal CLI, other bridges) appear in one unified list.

<img src="assets/sessions-demo.png" alt="Session picker — topic-first, click to resume" width="600">

### Bidirectional Media — Screenshots & Files Flow Back

Input has always been bidirectional: text, photos, documents, voice all flow to CC. Now **output is too**:

- **Screenshots**: CC takes a screenshot → image appears in your TG chat automatically
- **Files**: CC creates or references a file → bridge detects the path and sends it as a TG attachment
- **Long code**: Output >4000 chars with >60% code → sent as a file attachment with preview summary

The bridge captures images from SDK tool results (base64 data from Read/peekaboo/screenshot tools) and scans CC's response text for file paths. No manual copy-paste, no "where did you save it?" — files just appear in the chat.

<img src="assets/screenshot-relay-demo.png" alt="Screenshot relay — CC takes a screenshot, image appears in TG" width="600">

<img src="assets/file-relay-demo.png" alt="File relay — ask CC for a file, it appears as a download" width="600">

> **Reply to cancel**: Task taking too long? Send `/cancel` to abort. Need context from a previous message? Reply to it — the quoted text is automatically included as context.

### Multi-Agent Collaboration

Put `@claude-bot` and `@codex-bot` in the same Telegram group. Ask Claude to review code — Codex reads the reply via shared context and offers its own take automatically. Built-in loop guards and circuit breakers prevent runaway bot-to-bot conversations. For DM cross-checking, bots communicate directly via MCP/CLI — no relay needed.

### War Room — Multi-CC Command Center

Put all 4 CC bots in one Telegram group. Each bot stays silent until @mentioned — no crosstalk, no chaos. But every bot can read what the others said via shared context (Redis-backed). You orchestrate — they execute.

Two collaboration modes in one project:
- **A2A mode** (CC + Codex group): bots auto-respond to each other with loop guards — for brainstorming and debate
- **War Room mode** (multi-CC group): @mention only — for coordinated parallel execution

Done discussing? `/export` dumps the entire cross-bot conversation as a Markdown file — full audit trail, every bot's contribution timestamped.

<img src="assets/export-demo.png" alt="/export — War Room conversation exported as Markdown" width="600">

### Always-On, Self-Hosted

macOS LaunchAgent or Docker keeps the bridge running in the background. Sessions persist in SQLite across restarts and reboots — pick up where you left off after a reboot, a network drop, or a flight. Code and credentials never leave your machine. Owner-only access by default.

### Production-Grade Reliability

Not a toy — built for all-day use:

- **Send retry with backoff**: Exponential retry (3 attempts, 1s→2s→4s + jitter), auto-parse Telegram 429 rate limits, HTML→plaintext fallback on parse errors
- **Sliding-window rate limiter**: Configurable per-chat throttle (default 10 req/60s), auto-cleanup of expired windows
- **FlushGate message batching**: 800ms aggregation window (max 5 buffered), prevents rapid-fire messages from flooding the chat
- **Graceful shutdown**: 25-second drain timeout for active queries, force-abort hung tasks, progress message cleanup
- **Live streaming preview**: Real-time editMessage updates (2s throttle, 20-char min delta), tool call collapsing ("Bash x5" instead of 5 lines)
- **Polling conflict recovery**: Automatic detection and backoff when multiple processes poll the same bot token

> **Why this matters:** Claude's official tools give you one session, tied to a terminal. OpenClaw gives you one bot per session, isolated memory. This project gives you N parallel sessions with shared memory, persistent state, and full CC capabilities — the same productive workflow you have on desktop, now available everywhere you have Telegram.

---

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) runtime, a Telegram bot token (from [@BotFather](https://t.me/BotFather)), and at least one backend CLI: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://openai.com/index/codex/), or [Gemini CLI](https://ai.google.dev/gemini-api/docs/ai-studio-quickstart).

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
bun run bootstrap --backend claude
bun run setup --backend claude
bun run check --backend claude
bun run start --backend claude
```

> **Want parallel agents?** Add a second bot in 30 seconds — see [Multi-Instance Deployment](#multi-instance-deployment).

### Recommended Deployment

Run multiple bots for parallel workflows:

- `@cc-alpha` → Claude Code instance 1 (primary)
- `@cc-beta` → Claude Code instance 2 (parallel tasks)
- `@cc-gamma` → Claude Code instance 3 (parallel tasks)
- `@your-codex-bot` → Codex (different backend)

Each Claude instance shares memory automatically. No configuration needed — CC's memory lives in `~/.claude/`, not in the bot.

Supported backends:

| Backend | SDK | Status |
|---------|-----|--------|
| `claude` | Claude Code (via Agent SDK) | Recommended |
| `codex` | Codex CLI (via Codex SDK) | Recommended |
| `gemini` | Gemini Code Assist API | The "quiet scribe" — see note below |

> **Gemini's niche in this setup.** The Gemini backend is best used as an overnight note-taker in a multi-agent group: let Claude and Codex brainstorm, and have Gemini read along and summarize the conversation on a schedule. It is the least chatty of the three backends, which turns out to be a fit for that role. *Nothing in the code enforces a read-only mode* — you shape the behavior through the per-bot `CLAUDE.md` / prompt. It runs through Gemini Code Assist API, not a full CLI terminal, so capabilities are narrower than Claude Code or Codex.

> **Core rule:** One bot = one process = one independent agent. Run as many as you need.

> **The bridge is transparent.** Your TG bot inherits whatever skills, MCP servers, and hooks your local CC has. If CC can browse the web, generate images, or query databases in terminal — it can do the same through Telegram. The bridge adds session management; the capabilities come from CC itself.

---

## Telegram Commands

Sessions are sticky: messages continue the current session until you explicitly change it.

| Command | Description |
|---------|-------------|
| `/help` | Show all commands with descriptions |
| `/new` | Start a new session |
| `/cancel` | Abort the currently running task |
| `/sessions` | List recent sessions |
| `/peek <id>` | Read-only preview a session |
| `/resume <#\|id>` | Resume by sequence number or session ID |
| `/model` | Pick a model for the current bot |
| `/status` | Show backend, model, cwd, and session |
| `/dir` | Switch working directory |
| `/tasks` | Show recent task history |
| `/verbose 0\|1\|2` | Change progress verbosity |
| `/cron` | Manage scheduled tasks |
| `/export` | Export group shared context as Markdown file |
| `/doctor` | Run health check |
| `/a2a` | Show A2A bus status, peer health, and loop guard stats |

---

## How It Compares

Claude Code now ships [Remote Control](https://code.claude.com/docs/en/remote-control) (Feb 2026) and a [Telegram channel plugin](https://code.claude.com/docs/en/channels) (Mar 2026). Both let you talk to Claude from your phone. Neither gives you session management, multi-backend support, or agent-to-agent collaboration.

| Key differentiator | Remote Control | Channels | OpenClaw | **This project** |
|--------------------|:-:|:-:|:-:|:-:|
| Parallel sessions | &mdash; | &mdash; | 1 bot = 1 session | **N bots, shared memory** |
| Session management (new/resume/peek) | &mdash; | &mdash; | &mdash; | ✅ Full lifecycle |
| Image & file output relay | Terminal only | &mdash; | &mdash; | ✅ Auto-sent to chat |
| War Room (multi-agent) | &mdash; | &mdash; | &mdash; | ✅ @mention + shared context |
| Multi-backend (Claude/Codex/Gemini) | Claude only | Claude only | Provider-locked | ✅ All three |
| Always-on daemon | Terminal must stay open | Session-tied | Gateway | ✅ LaunchAgent / Docker |
| Production reliability | &mdash; | &mdash; | &mdash; | ✅ Retry, rate-limit, drain |

**What official tools do better:** Remote Control streams full terminal output. Channels relay tool-approval dialogs natively. This project optimizes for a different job: **persistent, multi-agent session management entirely from Telegram.**

<details>
<summary><strong>Full comparison (26 features)</strong></summary>

| Feature | [Remote Control](https://code.claude.com/docs/en/remote-control) | [Channels](https://code.claude.com/docs/en/channels) (TG plugin) | [OpenClaw](https://github.com/openclaw/openclaw) | This project |
|---------|:-:|:-:|:-:|:-:|
| Parallel sessions (multi-instance)    | &mdash; | &mdash; | 1 bot = 1 session | **N bots, N parallel CC instances, shared memory** |
| Create new sessions from phone        | &mdash; | &mdash; | &mdash; | `/new` |
| Browse & resume past sessions         | &mdash; | &mdash; | &mdash; | `/sessions` `/resume` `/peek` |
| Switch models on the fly              | &mdash; | &mdash; | Per-bot config | `/model` with inline buttons |
| Claude + Codex + Gemini backends      | Claude only | Claude only | Provider-locked | All three, per-chat switchable |
| Tool approval from phone              | Partial (limited UI) | Yes | Yes | Inline buttons: Allow / Deny / Always / YOLO |
| War Room (multi-agent command center) | &mdash; | &mdash; | &mdash; | @mention dispatch + Redis shared context |
| Multi-agent group collaboration       | &mdash; | &mdash; | &mdash; | A2A bus + shared context |
| Cross-agent collaboration             | &mdash; | &mdash; | Gateway channels | A2A broadcast (groups) + MCP/CLI (DMs) |
| Real-time progress streaming          | Terminal output only | &mdash; | Yes | **Live text preview** (editMessage streaming) + tool icons + 3 verbosity levels |
| Rapid message batching                | N/A | &mdash; | &mdash; | FlushGate: 800ms window, auto-merge |
| Photo / document / voice input        | &mdash; | Text only | Yes | Auto-download + reference in prompt |
| **Image / file output relay**         | Terminal only | &mdash; | &mdash; | **Screenshots & files auto-sent to TG chat** |
| Cancel running task                   | Ctrl+C in terminal | &mdash; | &mdash; | `/cancel` — abort from phone |
| Message reply context                 | N/A | &mdash; | &mdash; | Reply to any message → quoted text as context |
| Smart quick-reply buttons             | &mdash; | &mdash; | &mdash; | Yes/No + numbered options (1. 1、 1) formats) |
| Runs as background daemon             | Terminal must stay open | Session must be open | Yes (Gateway) | LaunchAgent / Docker |
| Survives network interruptions        | 10-min timeout kills session | Tied to session lifecycle | Gateway reconnect | SQLite + Redis persistence |
| Memory shared across instances        | N/A | N/A | Per-bot isolated | **All instances share CLAUDE.md + MCP memory** |
| Per-bot persona                       | N/A | N/A | SOUL.md per bot | Per-bot `CLAUDE.md` workspace + shared global rules |
| Group context compression             | N/A | N/A | N/A | 3-tier: recent full / middle truncated / old keywords |
| Shared context backend                | N/A | N/A | N/A | SQLite / JSON / Redis (pluggable) |
| Task audit trail                      | &mdash; | &mdash; | &mdash; | SQLite: status, cost, duration, approval log |
| Loop guard for bot-to-bot             | N/A | N/A | N/A | 5-layer: generation cap + AI self-decline + no-rebroadcast + idempotency + circuit breaker |
| Production reliability                | &mdash; | &mdash; | &mdash; | Exponential retry, rate-limit, FlushGate batching, graceful drain |
| Stable release                        | Yes | Research preview | Yes | Yes (v4.1) |

</details>

<details>
<summary><strong>Migrating from OpenClaw?</strong></summary>

Every OpenClaw feature has a direct equivalent — most of them are just CC running natively behind the bridge:

| OpenClaw feature | How this project handles it |
|---|---|
| **IM integration** (Telegram/WhatsApp) | grammy Telegram bot + Claude Code Agent SDK — runs full CC, not an API wrapper |
| **Multi-agent routing** | A2A bus (auto-debate) + War Room (@mention dispatch) |
| **Skills** | CC native skills (`~/.claude/skills/`) — no conversion needed |
| **Memory system** | CC native (`CLAUDE.md` + MCP memory like RecallNest) — shared across all instances |
| **Cron / scheduled tasks** | CC native cron — runs inside the agent, results delivered to TG |
| **Tool execution** (bash/fs/web) | CC native tools — Bash, Read, Write, Edit, Glob, Grep, WebFetch, etc. |
| **External agents (ACP)** | CC subagents + MCP servers |
| **Hooks** | CC native hooks (`~/.claude/settings.json`) |
| **Web UI** | **Telegram IS the UI** — inline buttons, notifications, multi-device, zero deployment |
| **SOUL.md persona** | Per-bot `CLAUDE.md` workspace + shared global rules |
| **Workspace memory** | Per-project `CLAUDE.md` + MCP memory — CC loads both automatically |

**The difference:** OpenClaw reimplements these features on top of an API. This project runs **actual Claude Code** — every feature CC has, you get for free.

</details>

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

### A2A-TG: Heterogeneous agents in one group chat

Beyond passive shared context, A2A-TG lets bots **actively respond** to each other. When one bot replies to a user, the A2A-TG bus broadcasts the envelope over loopback HTTP to sibling bots. Each sibling independently decides whether to chime in — and crucially, **it does not re-broadcast its own reply**, so the chain terminates by design.

```text
You:    @claude What's the best way to handle retries?
Claude: [responds with retry pattern advice]
         ↓ A2A-TG broadcast (generation=1)
Codex:  [reads Claude's reply, adds: "I'd also suggest exponential backoff..."]
         ✗ Codex's reply is NOT broadcast further — chain ends here
```

#### Why A2A-TG and not plain A2A

The [official A2A protocol](https://a2a-protocol.org) is designed for web services discovering each other via Agent Cards and exchanging long-running Tasks over HTTPS. telegram-ai-bridge runs agents in group chats, where peers are few and pre-configured, turns are short and high-frequency, and the dominant failure mode is ping-pong loops.

A2A-TG keeps the spirit (agent-to-agent peer communication, envelope with correlation/idempotency, TTL) but adds what IM actually needs:

- **`generation`** — a turn counter with a hard cap (`>= 2` is rejected). Official A2A has no equivalent.
- **Chat-scoped idempotency** — fingerprints are keyed on `(chat_id, sender, content)`, not on a web-service task ID.
- **Loopback-only transport** — peers live on `127.0.0.1`; there is no internet-facing endpoint and no OAuth dance.

Full field-by-field definition, compatibility matrix, and reserved-hooks list: **[A2A-TG v1 spec](docs/a2a-tg-v1.md)**.

#### Envelope at a glance

```json
{
  "protocol_version": "a2a-tg/v1",
  "message_id": "<time-ordered id>",
  "idempotency_key": "<unique per envelope>",
  "sender": "claude",
  "chat_id": -1001234567890,
  "generation": 1,
  "content": "...",
  "ttl_seconds": 300
}
```

Source of truth: [`a2a/envelope.js`](a2a/envelope.js). As of v1.1 the on-wire tag is `a2a-tg/v1` (self-identifying, distinct from official A2A). The validator still accepts the legacy `a2a/v1` tag during a two-minor-version compatibility window and logs a one-time deprecation warning per legacy tag, so running bot instances keep talking to each other mid-rollout (see spec §1, §9).

#### Five layers of loop suppression (all active today)

1. **Generation cap** — `validateEnvelope()` rejects `generation >= 2`. User prompts are generation 0, a bot's first reply is generation 1, any further rebroadcast is blocked at the wire.
2. **AI self-decline** — each bot's prompt allows returning `[NO_RESPONSE]` when it has nothing useful to add; the bridge skips the TG send.
3. **No-rebroadcast policy** — A2A-triggered replies are written to shared context and sent to Telegram, but are **not** re-broadcast through the A2A-TG bus. This breaks the ping-pong chain at the source. Reference: [`bridge.js:311`](bridge.js).
4. **Idempotency dedup** — SHA-256 fingerprint of `(chat_id, sender, content)` with 300s TTL rejects duplicate envelopes.
5. **Peer circuit breaker** — a peer that fails 3 times in a row is marked unavailable; a half-open probe resets it on recovery.

> `loop-guard.js` also keeps `cooldownMs` / `maxResponsesPerWindow` / `windowMs` as **reserved hooks** (not currently wired). The no-rebroadcast policy already covers loop prevention for the current architecture — the fields are preserved as extension points if a future mode ever re-enables chain replies.

#### Safety boundary

> **A2A-TG only works in group chats.** Private/DM conversations are never broadcast — this is enforced at both the inbound filter and the outbound broadcaster. Two people DMing two different bots on the same account cannot leak into each other's context.

#### Enable

```json
{
  "shared": {
    "a2aEnabled": true,
    "a2aPorts": { "claude": 18810, "codex": 18811 }
  }
}
```

Each bot instance listens on its assigned loopback port. Peers are auto-discovered from `a2aPorts` (excluding self). `/a2a` from Telegram shows live stats — bus status, peer health, loop-guard counters.

For all local LaunchAgent instances plus optional mini targets:

```bash
./scripts/status-all.sh
A2A_STATUS_URLS='mini-claude=http://mini.local:18810/a2a/status' ./scripts/status-all.sh
```

#### Where A2A-TG sits in the multi-agent landscape

Several projects solve *some* part of "make multiple AI agents work together." They tend to pick one axis and specialize. The table below is scoped to the multi-agent orchestration lane (not CC-remote-control, which is a different lane covered earlier).

| Project                                                                                   | Heterogeneous agents | Dedicated protocol layer       | IM as primary UI | Self-hosted |
|-------------------------------------------------------------------------------------------|:--------------------:|--------------------------------|:----------------:|:-----------:|
| [golutra](https://github.com/golutra/golutra)                                             | Yes (manual)         | GUI pipe, human-in-the-loop    | Desktop GUI      | Yes         |
| [claude-code-studio](https://github.com/AliceLJY/claude-code-studio)                      | CC only (homogeneous) | Redis + filesystem watcher    | Web UI           | Yes         |
| **telegram-ai-bridge** (this project)                                                     | Yes (CC + Codex + Gemini) | A2A-TG envelope + loop guards | Telegram         | Yes         |

The point is not that the others are worse — they are built for different tasks. golutra's strength is precise human routing; claude-code-studio's is deep homogeneous CC choreography. This project's strength is heterogeneous auto-coordination inside an IM surface you already carry in your pocket.

---

## Security & trust model

This bridge runs full Claude Code / Codex with your local credentials, so it is worth being explicit about what it does and does not protect against.

- **Owner gating protects the trigger, not the content.** `ownerTelegramId` controls who can invoke a bot. It does **not** sanitize the content of replies, shared context, or A2A-TG envelopes. Anyone already in an authorized group chat can see whatever the bots say.
- **Group chats write to shared storage.** Every bot reply in a group is written to the shared-context store (SQLite / JSON / Redis). Do not add the bots to a group you do not control — conversations persist on your disk, and any bot in the group can read them when next @mentioned.
- **A2A-TG broadcasts are loopback-only and group-scoped.** Envelopes never leave `127.0.0.1`, and the inbound/outbound filters reject `chat_id > 0` (DMs). Two people DMing two bots cannot leak into each other's context.
- **`bypassPermissions` disables tool approval prompts.** With this mode enabled, the bot executes Bash / Write / Edit tools without asking. That is convenient for personal use on your own machine; it is dangerous if anyone else can reach the bot. Keep it off unless you understand the blast radius.
- **Secrets in config.** `config.json` is `.gitignore`'d. `bun run config` redacts secrets when printing. Do not share bridge logs raw — they can contain tool outputs with sensitive paths.
- **Upstream trust.** The bridge inherits whatever your local Claude Code / Codex / Gemini can do — MCP servers, hooks, skills. If you install an untrusted skill or MCP, the bot inherits the risk.

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
    "redisUrl": "",
    "streamPreviewEnabled": true
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
- Positioned as the "quiet scribe" in a multi-agent group — a good role for overnight summarization, not for front-line coding
- Requires `~/.gemini/oauth_creds.json`, `oauthClientId`, `oauthClientSecret`
- Uses Gemini Code Assist API mode, not full CLI terminal control
- Behavior is shaped through prompt/workspace `CLAUDE.md`, not a code-level read-only switch

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
./scripts/install-launch-agent.sh --backend claude --instance 2 --config config-2.json --install
bun run check-configs config.example.json config-2.json
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
./scripts/install-log-rotation.sh --install
```

The wrapper runs `bun run check` before `bun run start`, so bad config fails fast.
Logs are written under `~/Library/Logs/telegram-ai-bridge/` and the rotation agent copy-truncates them daily at 03:00.

Default labels: `com.telegram-ai-bridge`, `com.telegram-ai-bridge-codex`, `com.telegram-ai-bridge-gemini`.

```bash
launchctl print gui/$(id -u)/com.telegram-ai-bridge
launchctl kickstart -k gui/$(id -u)/com.telegram-ai-bridge
tail -f ~/Library/Logs/telegram-ai-bridge/bridge.log
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
- `streaming-preview.js` — Live text preview via editMessage (throttled, with degradation)
- `send-retry.js` — Outbound delivery retry with error classification and HTML fallback
- `file-ref-protect.js` — Prevents Telegram auto-linking filenames as domains (.md, .go, .py etc.)
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
| **Telegram Group** | **A2A-TG** v1 (this project) | Loopback HTTP envelope bus with generation-based loop guards | Multiple heterogeneous bots in one group, chiming in |
| **Telegram DM** | MCP / CLI | Bots call each other directly via terminal config | Direct cross-bot communication, no bridge needed |
| **Server** | [Official A2A](https://a2a-protocol.org) v0.3.0 | [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) *(archived — A2A now built into OpenClaw)* | Web-service agents across servers |

> **MCP vs A2A**: MCP is a tool-calling protocol (I invoke your capability). A2A is a peer communication protocol (I talk to you as an equal). CC calling Codex via MCP is using Codex as a tool — not two agents chatting.
>
> **Official A2A vs A2A-TG**: Official A2A is a Linux Foundation project (originally proposed by Google) for web-service-to-web-service interop. A2A-TG is this repository's IM-scenario envelope inspired by A2A — different scope, different transport, different loop model. Not interchangeable. See [A2A-TG v1 spec §7](docs/a2a-tg-v1.md#7-relation-to-official-a2a).

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

### Server: openclaw-a2a-gateway *(archived)*

For OpenClaw agents communicating across servers via the official A2A v0.3.0 protocol (Linux Foundation project, originally proposed by Google). A2A is now built into OpenClaw as a native plugin — the standalone gateway has been archived. See [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) for historical reference.

Code attribution: the `a2a/` directory in this repository (envelope, idempotency store, peer-health manager) started as a simplified port of openclaw-a2a-gateway (MIT license) and has since diverged into the A2A-TG shape. Original copyright and license text are preserved.

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
