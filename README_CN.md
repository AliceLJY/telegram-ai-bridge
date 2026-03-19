<div align="center">

# telegram-ai-bridge

**用 Telegram 远程操控你的本地 AI Agent**

*Claude Code 在桌面上跑着，你在手机上接着聊。*

一个自托管的 Telegram 桥接工具，把一个 bot 连到一个本地 AI CLI——支持会话持久化、可恢复的 agent 工作流和 owner-only 权限模型。

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)

[English](README.md) | **简体中文**

</div>

---

## 这个项目解决什么问题

很多"Telegram + AI"项目本质上只是聊天壳。这个是本地 coding agent 的**遥控器**。

- 面向的是本地 coding agent（Claude Code、Codex），而不是泛聊天机器人
- 会话和凭证留在你自己的机器上
- 能承接真实的 resumable agent workflow
- 默认就是 owner-only 的个人远程控制

> **核心产品规则：** 一个 bot = 一个 backend = 一套清晰心智模型

支持的后端：

| 后端 | SDK | 状态 |
|------|-----|------|
| `claude` | Claude Agent SDK | 主推荐 |
| `codex` | Codex SDK | 主推荐 |
| `gemini` | Gemini Code Assist API | 实验兼容 |

这个项目刻意收窄，不做多通道 AI 工作台。它只为"手机 → Telegram → 本地 AI CLI"这条最短路径优化。

---

## 快速开始

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
bun run bootstrap --backend claude
bun run setup --backend claude
bun run check --backend claude
bun run start --backend claude
```

### 推荐部署方式

不同 agent 用不同 bot：

- `@your-claude-bot` → 只连 Claude
- `@your-codex-bot` → 只连 Codex
- `@your-gemini-bot` → 只连 Gemini（明确需要时再开）

---

## 你能得到什么

| 功能 | 说明 |
|------|------|
| **统一启动** | `bun run start --backend <name>` |
| **初始化向导** | `bun run setup` — 交互式配置生成 |
| **预飞检查** | `bun run check --backend <name>` — 校验配置和 CLI 状态 |
| **会话持久化** | SQLite 支撑，粘性会话，支持恢复和预览 |
| **任务跟踪** | 持久化审批和执行记录 |
| **Owner-only** | 只有你的 Telegram ID 能操作 |
| **双执行模式** | `direct`（进程内）或 `local-agent`（JSONL stdio 子进程） |
| **Docker 支持** | 同一套运行方式，凭证目录挂载进去 |
| **macOS LaunchAgent** | 自动生成 plist，后台常驻 |
| **群聊共享上下文** | 多个 bot 在同一群里互相看到对方的回复（SQLite / JSON / Redis） |
| **CI** | Bun 测试接入 GitHub Actions |

---

## Telegram 命令

会话默认是粘住的：只要你不主动切，后续消息继续当前会话。

| 命令 | 说明 |
|------|------|
| `/new` | 新建会话 |
| `/sessions` | 查看最近会话 |
| `/peek <id>` | 只读预览某个会话 |
| `/resume <id>` | 把当前聊天重新绑定到已拥有会话 |
| `/model` | 切换当前 bot 的模型 |
| `/status` | 查看后端、模型、工作目录和会话 |
| `/tasks` | 查看最近任务记录 |
| `/verbose 0\|1\|2` | 调整进度输出详细度 |

---

## 多 Bot 群聊协作

Telegram 的平台限制：bot 之间互相收不到消息。把 Claude 和 Codex 放在同一个群里，它们看不到对方说了什么。

本项目通过**可插拔的共享上下文存储**绕过这个限制。每个 bot 回复后把内容写入共享存储，其他 bot 被 @ 时读取共享上下文，把对方的回复带入 prompt。

```text
你:     @claude 帮我 review 这段代码
CC:     [review 完毕，回复写入共享存储]

你:     @codex 你同意 CC 的 review 吗？
Codex:  [从共享存储读到 CC 的回复，给出自己的意见]
```

不用再复制粘贴。内置三重保护（30 条 / 3000 token / 20 分钟过期）防止上下文膨胀。

### 存储后端对比

| 后端 | 依赖 | 并发 | 适用场景 |
|------|------|------|----------|
| `sqlite`（默认）| 无（内置）| WAL 模式，单写 | 单 bot、低并发 |
| `json` | 无（内置）| 原子写（tmp+rename）| 零依赖部署 |
| `redis` | `ioredis` | 原生并发 + TTL | 多 bot、Docker 环境 |

在 `config.json` 中设置 `sharedContextBackend`：

```json
{
  "shared": {
    "sharedContextBackend": "redis",
    "redisUrl": "redis://localhost:6379"
  }
}
```

> **注意：** bot 只在被 @ 或被回复时才响应，不会自动互相接话。

### A2A：Bot 间主动对话

共享上下文是被动的（被 @ 时才读取）。A2A 让 bot **主动接话**——群聊中一个 bot 回复用户后，A2A 总线把回复广播给兄弟 bot，每个兄弟独立判断要不要补充。

```text
你:     @claude 重试策略怎么写比较好？
Claude: [给出重试建议]
         ↓ A2A 广播
Codex:  [读到 Claude 的回复，补充："我建议再加个指数退避..."]
```

内置安全机制：
- **防死循环**：每轮对话最多 2 代 bot-to-bot 回复
- **冷却期**：每个 bot 的 A2A 响应间隔至少 60 秒
- **熔断器**：连续 3 次失败自动屏蔽不可达的 peer
- **限流**：每 5 分钟窗口最多 3 次 A2A 响应

> **重要：A2A 仅在群聊中生效。** 私聊/DM 消息不会被广播——防止不同 DM 窗口之间的消息泄漏。

在 `config.json` 中启用：

```json
{
  "shared": {
    "a2aEnabled": true,
    "a2aPorts": { "claude": 18810, "codex": 18811 }
  }
}
```

每个 bot 实例监听自己的端口。Peer 列表从 `a2aPorts` 自动发现（排除自身）。

---

## 架构

```text
Telegram bot
  → start.js
  → config.json
  → bridge.js
  → executor（direct | local-agent）
  → backend adapter（claude | codex | gemini）
  → 本地凭证和 session 文件
```

每个 bot 实例都有自己独立的 Telegram token、SQLite DB、凭证目录和模型配置。

---

<details>
<summary><strong>配置说明</strong></summary>

`bun run bootstrap --backend claude` 生成起步版 `config.json`。也可以直接复制 `config.example.json`。

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

`config.json` 已加入 `.gitignore`。`shared.sessionTimeoutMs` 只控制单次请求超时，不控制闲置会话过期。

查看最终生效配置：`bun run config --backend claude`（敏感字段自动隐藏）。

</details>

<details>
<summary><strong>后端说明</strong></summary>

**Claude：**
- 需要本地登录状态 `~/.claude/`
- 支持 `permissionMode`：`default` 或 `bypassPermissions`

**Codex：**
- 需要本地登录状态 `~/.codex/`
- `model` 可留空，使用 Codex 默认模型

**Gemini：**
- 实验兼容后端，不是主推荐路径
- 需要 `~/.gemini/oauth_creds.json`、`oauthClientId`、`oauthClientSecret`
- 走 Gemini Code Assist API 模式，不是完整 CLI 终端控制
- 只有明确需要 Gemini 时再启用

</details>

<details>
<summary><strong>macOS LaunchAgent</strong></summary>

生成并安装：

```bash
./scripts/install-launch-agent.sh --backend claude --install
./scripts/install-launch-agent.sh --backend codex --install
```

包装层会先跑 `bun run check` 再跑 `bun run start`，配置有问题直接失败。

默认 label：`com.telegram-ai-bridge`、`com.telegram-ai-bridge-codex`、`com.telegram-ai-bridge-gemini`。

```bash
launchctl print gui/$(id -u)/com.telegram-ai-bridge
launchctl kickstart -k gui/$(id -u)/com.telegram-ai-bridge
tail -f bridge.log
```

如果日志出现 `409 Conflict`，说明另一条进程在轮询同一个 bot token。

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

其他后端替换挂载目录和 `--backend`。详见 `docker-compose.example.yml`。

</details>

<details>
<summary><strong>项目结构</strong></summary>

- `start.js` — `start` / `bootstrap` / `check` / `setup` / `config` CLI 入口
- `config.js` — 配置加载与 setup wizard
- `bridge.js` — Telegram bot 运行时
- `sessions.js` — SQLite 会话持久化
- `shared-context.js` — 跨 bot 共享上下文入口
- `shared-context/` — 可插拔后端（SQLite / JSON / Redis）
- `a2a/` — Bot 间通信总线、防死循环、节点健康检测
- `adapters/` — 后端接入层
- `launchd/` — macOS LaunchAgent 模板
- `scripts/` — 安装脚本与运行包装器
- `docker-compose.example.yml` — Compose 起步模板

</details>

<details>
<summary><strong>执行模式</strong></summary>

- `direct` — 进程内直接调用 backend adapter（默认）
- `local-agent` — 通过 JSONL stdio 与本地 agent 子进程通讯

在 `config.json` 的 `shared.executor` 中设置，或用 `BRIDGE_EXECUTOR` 覆盖。

</details>

---

## 开发

```bash
bun test
```

GitHub Actions 会在每次 push 和 pull request 上运行同一套测试。

## 许可证

MIT
