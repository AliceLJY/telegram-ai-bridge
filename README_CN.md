<div align="center">

# telegram-ai-bridge

**你的 AI Agent，在 Telegram 里全权管理**

*手机上同时开 4 个 Claude Code 窗口。共享记忆，独立上下文，零配置漂移。*

一个自托管的 Telegram 桥接工具，把你的手机变成多窗口 AI 终端——完整控制 Claude Code、Codex、Gemini。

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)

[English](README.md) | **简体中文**

</div>

---

## 为什么不直接用 Claude 官方的远程功能？

Claude Code 先后上线了 [Remote Control](https://code.claude.com/docs/en/remote-control)（2026.2）和 [Telegram 频道插件](https://code.claude.com/docs/en/channels)（2026.3）。都能从手机跟 Claude 聊天，但都做不到会话管理、多后端、多 Agent 协作。

| 你在手机上想做的 | [Remote Control](https://code.claude.com/docs/en/remote-control) | [Channels](https://code.claude.com/docs/en/channels)（TG 插件） | [OpenClaw](https://github.com/openclaw/openclaw) | 本项目 |
|-----------------|:-:|:-:|:-:|:-:|
| 多实例并行会话 | &mdash; | &mdash; | 1 bot = 1 会话 | **N 个 bot，N 个并行 CC 实例，共享记忆** |
| War Room 指挥中心 | &mdash; | &mdash; | &mdash; | @点名派活 + Redis 共享上下文 |
| 从手机新建会话 | &mdash; | &mdash; | &mdash; | `/new` |
| 浏览并恢复历史会话 | &mdash; | &mdash; | &mdash; | `/sessions` `/resume` `/peek` |
| 随时切换模型 | &mdash; | &mdash; | 按 bot 配置 | `/model` 按钮选择 |
| Claude + Codex + Gemini 多后端 | 仅 Claude | 仅 Claude | 绑定 Provider | 全部支持，按 chat 切换 |
| 手机审批工具调用 | 部分（UI 有限） | 支持 | 支持 | 按钮：允许 / 拒绝 / 始终允许 / YOLO |
| 多 Agent 群聊协作 | &mdash; | &mdash; | &mdash; | A2A 总线 + 共享上下文 |
| 跨 Agent 协作 | &mdash; | &mdash; | Gateway 频道 | A2A 广播（群聊）+ MCP/CLI（私聊） |
| 实时进度流式展示 | 终端输出 | &mdash; | 支持 | 工具图标 + 3 级详细度 + 完成摘要 |
| 连续消息合并发送 | N/A | &mdash; | &mdash; | FlushGate：800ms 窗口自动合并 |
| 图片 / 文件 / 语音输入 | &mdash; | 仅文字 | 支持 | 自动下载 + 注入 prompt |
| 智能快捷回复按钮 | &mdash; | &mdash; | &mdash; | 是否类 + 数字选项（支持 1. 1、 1) 格式） |
| 后台常驻运行 | 终端关了就断 | 会话关了就断 | Gateway 常驻 | LaunchAgent / Docker |
| 断网恢复 | 10 分钟超时断开 | 跟随会话生命周期 | Gateway 重连 | SQLite + Redis 持久化 |
| 跨实例共享记忆 | N/A | N/A | 按 bot 隔离 | **所有实例共享 CLAUDE.md + MCP 记忆** |
| 每 bot 独立人格 | N/A | N/A | SOUL.md 按 bot | 工作空间 `CLAUDE.md` + 共享全局规则 |
| 群聊上下文压缩 | N/A | N/A | N/A | 三级：近期原文 / 中期截断 / 远期关键词 |
| 共享上下文后端 | N/A | N/A | N/A | SQLite / JSON / Redis（可插拔） |
| 任务审计追踪 | &mdash; | &mdash; | &mdash; | SQLite：状态、费用、耗时、审批记录 |
| bot 间对话防环 | N/A | N/A | N/A | 五层：代数 + 冷却 + 限速 + 去重 + AI 判断 |
| 稳定版本 | 是 | research preview | 是 | 是（v2.2） |

**官方工具的长处：** Remote Control 能实时看完整终端输出。Channels 能原生转发工具授权请求。Claude Code Web 提供云端算力，不需要本地环境。本项目专注另一件事：**在 Telegram 里做持久化的多 Agent 会话管理。**

### 想脱离 OpenClaw？对照表在这

OpenClaw 的每个功能，这里都有直接对应——而且大部分就是 CC 原生能力，不需要额外实现：

| OpenClaw 功能 | 本项目怎么做的 |
|---|---|
| **IM 接入**（Telegram/WhatsApp） | grammy Telegram bot + Claude Code Agent SDK——跑的是完整 CC，不是 API 套壳 |
| **多 Agent 路由** | A2A 总线（自动辩论）+ War Room（@点名派活） |
| **Skills 技能包** | CC 原生 skill（`~/.claude/skills/`）——不需要转换 |
| **记忆系统** | CC 原生（`CLAUDE.md` + MCP 记忆如 RecallNest）——所有实例自动共享 |
| **定时任务（cron）** | CC 原生 cron——在 agent 内部运行，结果投递到 TG |
| **工具调用**（bash/fs/web） | CC 原生工具——Bash、Read、Write、Edit、Glob、Grep、WebFetch 等 |
| **外部 Agent（ACP）** | CC 子 agent + MCP 服务器 |
| **Hooks 钩子** | CC 原生 hooks（`~/.claude/settings.json`） |
| **Web UI 管理** | **Telegram 就是 UI**——内联按钮、推送通知、多设备、零部署 |
| **SOUL.md 人格** | 每 bot 独立 `CLAUDE.md` 工作空间 + 共享全局规则 |
| **工作空间记忆** | 项目级 `CLAUDE.md` + MCP 记忆——CC 自动加载 |

**核心区别：** OpenClaw 在 API 之上重新实现这些功能。本项目跑的是**真正的 Claude Code**——CC 有的能力，你全部自动获得。

> **三者的区别：** Remote Control = 手机*看着*终端。Channels = 终端*收着*手机消息。本项目 = 手机**就是**终端。

支持的后端：

| 后端 | SDK | 状态 |
|------|-----|------|
| `claude` | Claude Code（通过 Agent SDK） | 主推荐 |
| `codex` | Codex CLI（通过 Codex SDK） | 主推荐 |
| `gemini` | Gemini Code Assist API | 实验兼容 |

> **核心规则：** 一个 bot = 一个独立进程 = 一个独立 Agent。想开几个开几个。

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

多 bot 并行，按需扩展：

- `@cc-alpha` → Claude Code 实例 1（主力）
- `@cc-beta` → Claude Code 实例 2（并行任务）
- `@cc-gamma` → Claude Code 实例 3（并行任务）
- `@your-codex-bot` → Codex（不同后端）

所有 Claude 实例自动共享记忆，无需配置——CC 的记忆在 `~/.claude/`，不在 bot 层。

---

## 能解锁什么

### 多窗口并行——手机就是多窗口终端

在电脑上你同时开 4-5 个 Claude Code 窗口。现在手机上也一样：

```
TG Bot 1 (🟣) ──→ CC 实例 1 ──┐
TG Bot 2 (🔵) ──→ CC 实例 2 ──┤── 共享：CLAUDE.md + MCP 记忆 + ~/.claude/
TG Bot 3 (🟢) ──→ CC 实例 3 ──┤
TG Bot 4 (🟡) ──→ CC 实例 4 ──┘
```

每个 bot 运行独立的 CC 进程，有自己的会话。所有实例共享同一套记忆层——你跟任何一个说过的话，其他的都知道。

**想要不同人格？** 给每个 bot 的 `cwd` 指向一个有自己 `CLAUDE.md` 的目录。CC 加载全局规则 + 工作空间人格——跟 OpenClaw 的 SOUL.md 一样，但背后是 CC 完整的 skill/hook/MCP 能力栈。

> **为什么这很重要：** OpenClaw 一个 bot = 一个会话，记忆隔离。官方工具一个会话，没了。本项目给你 N 个并行会话，共享记忆，可选独立人格。

### 手机优先的 Agent 控制

离开工位，打开 Telegram。`/new` 建新会话，`/resume 3` 恢复之前的进度，`/peek 5` 只读浏览某个会话，`/model` 随时切模型。完整的会话生命周期管理——不需要终端。

### 多 Agent 协作

把 `@claude-bot` 和 `@codex-bot` 拉进同一个 Telegram 群。让 Claude review 代码——Codex 通过共享上下文读到 Claude 的回复，自动给出自己的意见。内置防死循环和熔断机制，防止 bot 之间无限接话。私聊场景下，bot 通过 MCP/CLI 直接互通，无需中转。

### War Room——多 CC 指挥中心

把 4 个 CC bot 拉进同一个群。每个 bot @才说话——不抢话，不混乱。但每个 bot 都能通过共享上下文（Redis）读到其他人的回复。你来调度：

```
你:       @cc-alpha 分析这个 API 设计
Alpha:    [深度分析，写入共享上下文]

你:       @cc-beta 根据 Alpha 的分析写集成测试
Beta:     [读取 Alpha 的上下文，写测试]

你:       @cc-gamma 审查两边的产出——有没有遗漏？
Gamma:    [读取所有上下文，审查]

你:       @cc-delta 提交推送
Delta:    [读取完整上下文，commit and push]
```

**4 个 agent，1 个群，共享记忆，零噪音。** 两种协作模式：
- **A2A 模式**（CC + Codex 群）：bot 自动互相接话，适合头脑风暴
- **War Room 模式**（多 CC 群）：@点名才说话，适合协调并行执行

### 常驻运行，自托管

macOS LaunchAgent 或 Docker 让 bridge 在后台持续运行。会话持久化在 SQLite 里，重启、断网、重开机都不丢。代码和凭证不出本机。默认 owner-only 访问。

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
| `/a2a status` | 查看 A2A 总线状态、节点健康和防循环统计 |

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

## 通信全景图

三种让 AI agent 互相对话的方式——协议不同，场景不同：

| 层 | 协议 | 方式 | 场景 |
|---|------|------|------|
| **终端** | MCP | 内置 `codex mcp-server` + `claude mcp serve`，零代码 | CC ↔ Codex 在终端互调 |
| **TG 群聊** | 自定义 A2A | 本项目的 A2A 总线，自动广播 | 多 bot 同群接话 |
| **TG 私聊** | MCP / CLI | Bot 通过终端配置直接互通 | 无需中转，直接跨 bot 通信 |
| **服务端** | Google A2A v0.3.0 | [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) | OpenClaw agent 跨服务器通信 |

> **MCP vs A2A**：MCP 是工具调用协议（我调你的能力），A2A 是对等通信协议（我跟你对话）。CC 通过 MCP 调 Codex，本质是把 Codex 当工具用，不是两个 agent 在聊天。

### 终端：CLI 直连（不经过 Telegram）

Claude Code 和 Codex 各自内置了 MCP server 模式，互相注册就通了——不需要桥接、不需要 Telegram、不需要写代码：

```bash
# Claude Code 里注册 Codex
claude mcp add codex -- codex mcp-server

# Codex 里注册 Claude Code（在 ~/.codex/config.toml）
[mcp_servers.claude-code]
type = "stdio"
command = "claude"
args = ["mcp", "serve"]
```

### Telegram：本项目

群聊走 A2A 自动广播，私聊通过 MCP/CLI 直接互通。详见上面的章节。

### 服务端：openclaw-a2a-gateway

OpenClaw agent 通过 Google A2A v0.3.0 标准协议跨服务器通信。完全不同的系统——见 [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway)。

## 开发

```bash
bun test
```

GitHub Actions 会在每次 push 和 pull request 上运行同一套测试。

## 许可证

MIT
