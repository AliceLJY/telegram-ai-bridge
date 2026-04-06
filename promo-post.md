# Promo Posts for telegram-ai-bridge

## X/Twitter (short)

I run 4 parallel Claude Code sessions from my phone via Telegram.

Each bot is an independent CC instance. All share the same memory — what I tell one, the others already know. Per-bot personas via workspace CLAUDE.md.

Things Claude's official Remote Control and OpenClaw can't do:
→ Multiple parallel sessions
→ Shared memory across instances
→ Create/resume/browse sessions from phone
→ A2A multi-agent collaboration in group chats

Open source, self-hosted, MIT:
https://github.com/AliceLJY/telegram-ai-bridge

---

## Reddit r/ClaudeAI (medium)

**Title:** I built a Telegram bridge that runs 4 parallel Claude Code sessions from my phone — with shared memory

**Body:**

I've been using Claude Code as my primary dev tool for months. The one thing that bugged me: I run 4-5 CC windows on my desktop simultaneously, but when I'm away from my desk, I'm cut off.

Claude's official Remote Control lets you watch the terminal. The Channels plugin lets you send messages. Neither lets you create sessions, resume old ones, run parallel instances, or manage multi-agent workflows.

So I built **telegram-ai-bridge** — a self-hosted Telegram bot that turns your phone into a multi-window CC terminal:

**What it does:**
- Run N parallel CC instances, each as its own Telegram bot
- All instances share `~/.claude/` memory automatically — no sync, no config
- Each bot can have its own persona via workspace `CLAUDE.md`
- Full session lifecycle: `/new`, `/resume`, `/sessions`, `/peek`
- Tool approval from phone: Allow / Deny / Always / YOLO
- Multi-agent group collaboration: put CC + Codex bots in one group, they share context and respond to each other
- Always-on via macOS LaunchAgent or Docker

**Architecture:**
```
TG Bot 1 → CC Instance 1 ──┐
TG Bot 2 → CC Instance 2 ──┤── Shared: CLAUDE.md + MCP memory
TG Bot 3 → CC Instance 3 ──┤
TG Bot 4 → CC Instance 4 ──┘
```

**How it compares:**

| Feature | Claude Remote Control | Claude Channels | OpenClaw | This |
|---------|:-:|:-:|:-:|:-:|
| Parallel sessions | ✗ | ✗ | 1 per bot | N parallel, shared memory |
| Create new sessions | ✗ | ✗ | ✗ | `/new` |
| Resume old sessions | ✗ | ✗ | ✗ | `/sessions` + `/resume` |
| Per-bot persona | N/A | N/A | SOUL.md (isolated) | CLAUDE.md (shared global + per-bot) |
| Multi-backend | Claude only | Claude only | Provider-locked | Claude + Codex + Gemini |
| Memory across instances | N/A | N/A | Isolated | Shared automatically |

Built with Bun + grammy + Claude Agent SDK. MIT licensed.

**GitHub:** https://github.com/AliceLJY/telegram-ai-bridge

**One-command installer** (includes shared memory layer): https://github.com/AliceLJY/agent-nexus

Happy to answer questions. This started as a personal tool and has become my daily driver — I literally manage all my CC work from my phone now.

---

## Hacker News (concise)

**Title:** Show HN: Run parallel Claude Code sessions from Telegram with shared memory

**Body:**

telegram-ai-bridge is a self-hosted Telegram bot that gives you full session control over local AI coding agents (Claude Code, Codex, Gemini).

The key differentiator: you can run N parallel instances, each as its own Telegram bot, all sharing the same memory layer. Claude's official Remote Control and Channels plugin don't support parallel sessions, session creation, or multi-agent collaboration.

Each bot can optionally have its own persona via workspace-level configuration, while sharing global rules and MCP memory automatically.

Built with Bun, grammy, and the Claude Agent SDK. MIT licensed.

https://github.com/AliceLJY/telegram-ai-bridge
