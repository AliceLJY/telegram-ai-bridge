# A2A-TG v1 — Telegram-native Agent Envelope

> **Status:** draft · 2026-04 · living document
> **Scope:** the `a2a/` package inside [telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge)
> **Relation to official A2A:** inspired by, not compatible with. See [§7 Relation to official A2A](#7-relation-to-official-a2a).

## 0. Why a separate protocol

The official [A2A protocol](https://a2a-protocol.org) (originally proposed by Google, now a Linux Foundation project) is designed for agent-to-agent interop between *web services* — Agent Cards advertise capabilities at a URL, Tasks carry stateful work units over HTTP/JSON-RPC, and discovery happens through well-known endpoints.

telegram-ai-bridge runs agents inside **IM group chats**, where:

- Peers are few (typically 2-4 bots in one Telegram group) and pre-configured, not discovered
- Messages are short, high-frequency, conversational, and directly visible to end users
- The dominant failure mode is **bot-to-bot ping-pong loops**, not service unavailability
- The transport is already constrained by Telegram's platform (chat-scoped, no bot-to-bot visibility)

Forcing the official A2A shape onto this scenario would discard features we actually need (generation-based loop suppression, chat-scoped idempotency, TTL on short conversational turns) in exchange for capabilities we don't use (Agent Card discovery, long-running Task state machines).

**A2A-TG** is a smaller, IM-specific envelope protocol that borrows vocabulary and spirit from official A2A but optimizes for the conversation-in-IM case. This document defines version 1.

## 1. Naming and identifier

- **Protocol name:** A2A-TG
- **Version:** 1 (this document)
- **On-wire version tag:** `a2a/v1`
  - *Historical note:* the current implementation emits `protocol_version: "a2a/v1"` on the envelope. A future v1.1 will migrate to `a2a-tg/v1` to avoid any visual confusion with official A2A payloads. Until then, readers should treat `a2a/v1` **on the `/a2a/message` transport defined below** as A2A-TG, not official A2A.
- **Package path:** `a2a/` inside telegram-ai-bridge

## 2. Envelope

One A2A-TG message is one JSON object with the following fields. Source of truth: [`a2a/envelope.js`](../a2a/envelope.js).

| Field                  | Type    | Required | Notes |
|------------------------|---------|----------|-------|
| `protocol_version`     | string  | yes      | `"a2a/v1"` (see §1) |
| `message_id`           | string  | yes      | `{timestamp_hex}-{12 hex chars}`, time-ordered, globally unique per sender |
| `idempotency_key`      | string  | yes      | Same format as `message_id`; consumers dedupe on this |
| `correlation_id`       | string? | no       | Optional; groups related turns in one logical conversation |
| `timestamp`            | string  | yes      | ISO-8601 UTC, creation time at the sender |
| `ttl_seconds`          | number  | no       | Default `300`. Envelope expires `timestamp + ttl_seconds` |
| `sender`               | string  | yes      | Bot identity: `claude` / `codex` / `gemini` / custom |
| `sender_username`      | string  | no       | Telegram bot username (without `@`), for UI display |
| `chat_id`              | number  | yes      | Telegram chat ID. **Must be `< 0` (group) for delivery — DMs are rejected upstream** |
| `generation`           | number  | yes      | See §3 |
| `content`              | string  | yes      | The bot's reply text |
| `original_prompt`      | string  | no       | Truncated copy of the user prompt that triggered the reply, for consumer context |
| `telegram_message_id`  | number? | no       | TG message ID of the original reply, for UI linking |

### Example

```json
{
  "protocol_version": "a2a/v1",
  "message_id": "18f3a1c9b24-a1b2c3d4e5f6",
  "idempotency_key": "18f3a1c9b24-7890abcdef12",
  "correlation_id": null,
  "timestamp": "2026-04-21T10:30:00.000Z",
  "ttl_seconds": 300,
  "sender": "claude",
  "sender_username": "my_claude_bot",
  "chat_id": -1001234567890,
  "generation": 1,
  "content": "Exponential backoff is the usual choice here...",
  "original_prompt": "@claude what's the best way to handle retries?",
  "telegram_message_id": 42
}
```

## 3. Generation — the core loop-suppression primitive

`generation` counts turns of bot-mediated rebroadcast from the original human prompt:

| Value | Meaning                                                         |
|-------|-----------------------------------------------------------------|
| `0`   | A human posted the message (never carried on the wire — implicit baseline) |
| `1`   | A bot's first reply, broadcast to peers                         |
| `>=2` | A bot replying to another bot's reply — **rejected at the validator** |

Because the bridge never re-broadcasts A2A-triggered replies (see §5.3), in practice only `generation = 1` envelopes cross the wire. The hard cap at `2` is defense-in-depth.

This field has **no equivalent in official A2A**. It is the single most important addition and is the reason the protocol is named separately.

## 4. Transport

- **Scheme:** HTTP/1.1 over loopback (default `127.0.0.1`) only
- **Method:** `POST`
- **Path:** `/a2a/message`
- **Content-Type:** `application/json`
- **Port per peer:** configured in `config.json` at `shared.a2aPorts` (e.g. `{ "claude": 18810, "codex": 18811 }`). Each bot instance listens on exactly one port.
- **Timeout:** sender aborts at 5 seconds (`AbortSignal.timeout(5000)`)
- **Proxy bypass:** localhost calls strip `HTTP(S)_PROXY` env vars before `fetch`, so ClashX or similar do not route loopback traffic

### Response

| HTTP status | Body                                                         | Meaning |
|-------------|--------------------------------------------------------------|---------|
| 200         | `{"status": "accepted"}`                                     | Delivered to handler |
| 200         | `{"status": "blocked", "reason": "..."}`                     | Loop-guard dropped the envelope |
| 400         | `{"status": "rejected", "error": "...", "message": "..."}`   | Validation failed |
| 400         | `{"status": "error", "message": "..."}`                      | JSON parse error |
| 500         | `{"status": "error", "message": "..."}`                      | Handler threw |

Error codes emitted by the validator: `INVALID_VERSION`, `MISSING_FIELD`, `EXPIRED`, `GENERATION_LIMIT`, `PAYLOAD_TOO_LARGE`.

## 5. Safety layers

Five layers of defense-in-depth against runaway bot-to-bot conversations. Every envelope that passes `shouldProcess()` must clear all active layers.

### 5.1 Generation cap (active)

`validateEnvelope()` and `LoopGuard.shouldProcess()` both reject `generation >= 2`. Hard-coded, not configurable — a misconfigured peer cannot opt out.

### 5.2 AI self-decline (active)

Each receiving bot's prompt is augmented with an instruction to return the literal string `[NO_RESPONSE]` when it has nothing useful to add. The bridge detects this and skips the TG send. This is an orthogonal layer to the wire protocol — the envelope still gets processed, the bot just chooses silence.

### 5.3 No-rebroadcast policy (active)

After a bot handles an inbound A2A envelope and generates a reply, the bridge writes that reply to:

1. The Telegram chat (as a normal bot message)
2. The shared-context store (so peers can see it when next mentioned)

It does **not** call `bus.broadcast()` again. This breaks the ping-pong chain at the source. Reference: [`bridge.js:311`](../bridge.js).

### 5.4 Idempotency (active)

`IdempotencyStore` keeps a map of `idempotency_key → SHA-256(chat_id:sender:content)` with a 300 s TTL. Duplicate keys with matching fingerprints are dropped. Conflicting fingerprints (same key, different content) are treated as new messages — the logic is conservative, not strict.

### 5.5 Peer circuit breaker (active)

`PeerHealthManager` implements three-state breakers (closed → open → half-open → closed) per peer:

- 3 consecutive failures → `open` (skip this peer on broadcast)
- 30 s after opening → `half-open` (one probe request allowed)
- Probe success → `closed`; probe failure → back to `open`

### 5.6 Reserved hooks (not active)

`LoopGuard` exposes `cooldownMs`, `maxResponsesPerWindow`, `windowMs` fields and a `recordResponse(chatId)` method. None of them are currently called — the no-rebroadcast policy (§5.3) makes per-chat cooldown redundant for the current architecture. They are preserved in the source as reserved hooks for a future mode that re-enables chain replies with tighter throttling.

## 6. Dependencies on the rest of the bridge

A2A-TG by itself is an envelope + transport + loop-guard bundle. The following capabilities **belong to telegram-ai-bridge**, not to the protocol:

- Shared-context store (SQLite / JSON / Redis) — how peer bots see each other's replies *before* being @mentioned
- Telegram filter (reject `chat_id > 0` private chats at both inbound and outbound boundaries)
- Owner gating and rate limiting

A conformant A2A-TG implementation MUST NOT broadcast envelopes for private/DM chats. This is a security constraint of the protocol, not an application detail.

## 7. Relation to official A2A

A2A-TG is **not compatible** with the official A2A protocol. Agents cannot be directly interconnected without an adapter.

| Dimension                | Official A2A                                   | A2A-TG v1                              |
|--------------------------|------------------------------------------------|----------------------------------------|
| Target scenario          | Web services interoperating over the internet  | IM bots in a shared group chat         |
| Discovery                | Agent Card at well-known URL                   | Static peer map in `config.json`       |
| Identity primitive       | Agent Card (capabilities, endpoints, auth)     | `sender` + `sender_username` strings   |
| Work unit                | Task (long-running, stateful)                  | Message envelope (single turn)         |
| Wire shape               | JSON-RPC 2.0 over HTTPS                        | Plain JSON POST over loopback HTTP     |
| Transport scope          | Internet                                       | Localhost loopback only                |
| Loop suppression         | Not part of the spec                           | `generation` cap + idempotency + breaker |
| Scope binding            | Not scoped                                     | Bound to Telegram `chat_id` (groups only) |
| Auth                     | OAuth / bearer tokens / mTLS                   | Owner-gated, trust loopback            |

Interop path if ever needed: write a separate `a2a-tg ↔ official-a2a` adapter. Do not merge the two shapes inside the main protocol.

## 8. Attribution

- Concept influence: [official A2A protocol](https://a2a-protocol.org) (by Google, now stewarded by the Linux Foundation) — A2A-TG is not affiliated with or endorsed by the official project
- Initial envelope / idempotency / peer-health implementation ported (and simplified) from [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) (MIT license). Attribution requirement: retain copyright notice and license text.

## 9. Version history

| Version | Date     | Notes |
|---------|----------|-------|
| v1      | 2026-04  | Initial draft. Matches the implementation in telegram-ai-bridge 3.1.0. |
| v1.1    | planned  | Bump on-wire `protocol_version` from `a2a/v1` to `a2a-tg/v1` for clearer identity. No semantic changes. |
