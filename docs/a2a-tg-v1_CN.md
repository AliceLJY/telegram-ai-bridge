# A2A-TG v1 — 面向 IM 场景的 Agent 封装协议

> **状态：** draft · 2026-04 · 持续更新
> **范围：** [telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge) 仓库下的 `a2a/` 包
> **与官方 A2A 的关系：** 借鉴，不兼容。详见 [§7 与官方 A2A 的关系](#7-与官方-a2a-的关系)。
> **English:** [a2a-tg-v1.md](a2a-tg-v1.md)

## 0. 为什么需要单独一个协议

[官方 A2A 协议](https://a2a-protocol.org)（Google 最早提出，现在是 Linux Foundation 的开源项目）是给 *web service* 之间互通用的——Agent Card 在某个 URL 下暴露能力、Task 承载有状态的长事务、服务发现走 well-known endpoint。它假设 agent 是有稳定地址的服务端实体。

telegram-ai-bridge 的 agent 是**人 + bot + IM 上下文**打包在一起的东西，场景完全不同：

- Peer 很少（通常一个 Telegram 群里 2-4 个 bot），预配置，不需要发现机制
- 消息短、高频、对话性，终端用户直接可见
- 主要威胁是**bot 之间的乒乓死循环**，不是服务不可用
- 传输本身被 Telegram 平台约束（按 chat 隔离，bot 互相看不到对方消息）

硬把官方 A2A 的形状套上来，会丢掉我们真正需要的东西（代际防环、chat 级指纹去重、短对话的 TTL），换来我们不用的能力（Agent Card 发现、长事务状态机）。

**A2A-TG** 是一个更小、专为 IM 场景设计的信封协议——词汇和精神借鉴官方 A2A，但围绕"IM 群聊里对话式协作"这个用例做优化。本文定义第 1 版。

## 1. 命名与标识

- **协议名：** A2A-TG
- **版本：** 1（本文）
- **线上版本标签：** `a2a-tg/v1`（v1.1 起，当前版本）
  - *历史说明：* v1.0 线上 tag 是 `a2a/v1`。v1.1 把 tag bump 到 `a2a-tg/v1`，让协议身份自证，不再跟官方 A2A payload 视觉混淆。过渡期内（至少保留两个次版本号的兼容窗口），验证器仍然接受旧 `a2a/v1` tag，并按每个旧 tag 打一次 deprecation 日志——这样在所有 bot 实例升级完之前不会互相拒收。无论 tag 新旧，**只有在下面定义的 `/a2a/message` 传输路径上**出现的信封才算 A2A-TG，不是官方 A2A。
- **包路径：** telegram-ai-bridge 下的 `a2a/`

## 2. Envelope（信封）

一条 A2A-TG 消息就是一个 JSON 对象，字段定义如下。源码真相：[`a2a/envelope.js`](../a2a/envelope.js)。

| 字段                   | 类型    | 必填 | 说明 |
|------------------------|---------|------|------|
| `protocol_version`     | string  | 是   | 出站一律写 `"a2a-tg/v1"`。过渡期内验证器也接受旧 `"a2a/v1"` tag，并按每个旧 tag 打一次 deprecation 日志。见 §1。 |
| `message_id`           | string  | 是   | 格式 `{timestamp_hex}-{12 位 hex}`，时间有序，发送方全局唯一 |
| `idempotency_key`      | string  | 是   | 格式同 `message_id`，消费方用它做去重 |
| `correlation_id`       | string? | 否   | 可选，把一个逻辑会话的多轮关联起来 |
| `timestamp`            | string  | 是   | 发送方创建时刻，ISO-8601 UTC |
| `ttl_seconds`          | number  | 否   | 默认 `300`，信封在 `timestamp + ttl_seconds` 后过期 |
| `sender`               | string  | 是   | Bot 身份：`claude` / `codex` / `gemini` / 自定义 |
| `sender_username`      | string  | 否   | TG bot username（不带 `@`），用于 UI 显示 |
| `chat_id`              | number  | 是   | Telegram chat ID。**必须 `< 0`（群聊）才会投递——DM 在上游就被拒绝** |
| `generation`           | number  | 是   | 见 §3 |
| `content`              | string  | 是   | Bot 的回复文本 |
| `original_prompt`      | string  | 否   | 触发回复的原始用户提问（可能被截断），帮助消费方理解上下文 |
| `telegram_message_id`  | number? | 否   | 原回复的 TG 消息 ID，用于 UI 链接 |

### 示例

```json
{
  "protocol_version": "a2a-tg/v1",
  "message_id": "18f3a1c9b24-a1b2c3d4e5f6",
  "idempotency_key": "18f3a1c9b24-7890abcdef12",
  "correlation_id": null,
  "timestamp": "2026-04-21T10:30:00.000Z",
  "ttl_seconds": 300,
  "sender": "claude",
  "sender_username": "my_claude_bot",
  "chat_id": -1001234567890,
  "generation": 1,
  "content": "指数退避通常是这里的首选...",
  "original_prompt": "@claude 重试策略怎么写比较好？",
  "telegram_message_id": 42
}
```

## 3. Generation——核心防环原语

`generation` 统计"从原始人类提问开始、经过 bot 中转广播"的轮数：

| 取值  | 含义                                                      |
|-------|-----------------------------------------------------------|
| `0`   | 人类发的消息（线上从不出现——是隐式基线）                   |
| `1`   | Bot 的第一次回复，广播给 peer                              |
| `>=2` | Bot 回复另一个 bot 的回复——**在验证器层直接拒收**          |

因为 bridge 从不把 A2A 触发的回复再广播出去（见 §5.3），实际上线上只有 `generation = 1` 的信封会出现。硬上限 `2` 是纵深防御的兜底。

**官方 A2A 里没有这个字段。** 这是 A2A-TG 最重要的新增特性，也是协议需要单独命名的原因。

## 4. 传输

- **协议：** HTTP/1.1，仅走 loopback（默认 `127.0.0.1`）
- **方法：** `POST`
- **路径：** `/a2a/message`
- **Content-Type：** `application/json`
- **每个 peer 一个端口：** 在 `config.json` 的 `shared.a2aPorts` 里配（例如 `{ "claude": 18810, "codex": 18811 }`）。每个 bot 实例监听一个端口。
- **超时：** 发送方 5 秒中止（`AbortSignal.timeout(5000)`）
- **代理绕行：** loopback 调用前会先剥掉 `HTTP(S)_PROXY` 环境变量，防止 ClashX 之类的代理把本机流量劫持到海外

### 响应

| HTTP 状态码 | Body                                                         | 含义 |
|-------------|--------------------------------------------------------------|------|
| 200         | `{"status": "accepted"}`                                     | 已投递给 handler |
| 200         | `{"status": "blocked", "reason": "..."}`                     | 防环层拦截 |
| 400         | `{"status": "rejected", "error": "...", "message": "..."}`   | 验证失败 |
| 400         | `{"status": "error", "message": "..."}`                      | JSON 解析错误 |
| 500         | `{"status": "error", "message": "..."}`                      | Handler 抛异常 |

验证器错误码：`INVALID_VERSION`、`MISSING_FIELD`、`EXPIRED`、`GENERATION_LIMIT`、`PAYLOAD_TOO_LARGE`。

## 5. 防环层

五层纵深防御，对付 bot 之间失控的乒乓接话。每个过了 `shouldProcess()` 的信封必须通过所有激活的层。

### 5.1 代际上限（激活）

`validateEnvelope()` 和 `LoopGuard.shouldProcess()` 双双拒绝 `generation >= 2`。硬编码、不可配置——配错了的 peer 也绕不开。

### 5.2 AI 自我拒答（激活）

每个接收方 bot 的 prompt 里都有一条约定："没啥要补充就返回 `[NO_RESPONSE]`"。bridge 检测到后跳过 TG 发送。这是一层跟线上协议正交的防护——信封照常处理，只是 bot 自己选择沉默。

### 5.3 不再广播策略（激活）

Bot 处理完一个入站 A2A 信封、生成回复后，bridge 把这条回复写到：

1. Telegram 群聊（作为普通 bot 消息）
2. 共享上下文存储（其他 peer 下次被 @ 时能看到）

**不**再次调用 `bus.broadcast()`——从源头切断乒乓链。参考：[`bridge.js:311`](../bridge.js)。

### 5.4 指纹去重（激活）

`IdempotencyStore` 维护一个 `idempotency_key → SHA-256(chat_id:sender:content)` 映射，TTL 300 秒。key 相同且指纹匹配的消息被丢弃；key 相同但内容不同（冲突）则当新消息处理——策略是宽松不是严格。

### 5.5 Peer 熔断（激活）

`PeerHealthManager` 给每个 peer 实现三态熔断器（closed → open → half-open → closed）：

- 连续失败 3 次 → `open`（广播时跳过这个 peer）
- 进入 open 状态 30 秒后 → `half-open`（放一个探针过去）
- 探针成功 → `closed`；探针失败 → 回到 `open`

### 5.6 预留 hook（未激活）

`LoopGuard` 暴露了 `cooldownMs`、`maxResponsesPerWindow`、`windowMs` 三个字段和 `recordResponse(chatId)` 方法，当前都**没有被调用**——不再广播策略（§5.3）已经让每 chat 冷却变得冗余。这些字段留在源码里作为未来如果重新启用链式回复、需要更细粒度限流时的扩展点。

## 6. 对 bridge 其他部分的依赖

A2A-TG 本身是"信封 + 传输 + 防环"三件套。下面这些能力属于 **telegram-ai-bridge**，不是协议本身的职责：

- 共享上下文存储（SQLite / JSON / Redis）——peer 在被 @ 之前怎么看到彼此的回复
- Telegram 过滤器（入站和出站都拒绝 `chat_id > 0` 的私聊）
- Owner 白名单和 rate limit

一个合规的 A2A-TG 实现**必须不能**为私聊/DM 广播信封。这是协议的安全约束，不是应用层细节。

## 7. 与官方 A2A 的关系

A2A-TG **不兼容**官方 A2A 协议。没有适配器的情况下，两边的 agent 不能直接互通。

| 维度                  | 官方 A2A                                      | A2A-TG v1                                |
|-----------------------|-----------------------------------------------|------------------------------------------|
| 目标场景              | Web service 互联网互通                        | IM 群聊里的 bot                          |
| 发现机制              | 某 well-known URL 下的 Agent Card             | `config.json` 里的静态 peer 映射         |
| 身份原语              | Agent Card（能力、端点、认证）                | `sender` + `sender_username` 字符串      |
| 工作单元              | Task（长事务、有状态）                        | 消息信封（单轮）                         |
| 线上格式              | JSON-RPC 2.0 over HTTPS                       | 普通 JSON POST over loopback HTTP        |
| 传输范围              | 公网                                          | 仅本机 loopback                          |
| 防环                  | 协议里没有                                    | `generation` 上限 + 指纹去重 + 熔断      |
| 作用域绑定            | 无                                            | 绑在 Telegram `chat_id`（仅群聊）        |
| 认证                  | OAuth / bearer token / mTLS                   | Owner 白名单，信任 loopback              |

如果将来真需要互通：写一个独立的 `a2a-tg ↔ official-a2a` 适配器。**不要**把两种形状混进主协议里。

## 8. 归属声明

- 概念影响：[官方 A2A 协议](https://a2a-protocol.org)（Google 最早提出，现由 Linux Foundation 管理）——A2A-TG 与官方项目没有从属关系，也未获其背书
- 最早的 envelope / idempotency / peer-health 实现从 [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway)（MIT 协议）简化移植而来。Attribution 要求：保留 copyright 和 license 文本。

## 9. 版本历史

| 版本  | 日期     | 说明 |
|-------|----------|------|
| v1    | 2026-04  | 初版。对应 telegram-ai-bridge 3.1.0 的实现。线上 tag：`a2a/v1`。 |
| v1.1  | 2026-04-21 | 线上 `protocol_version` 从 `a2a/v1` bump 到 `a2a-tg/v1`，身份自证。无语义/字段变化。验证器在过渡期内（至少保留两个次版本号的兼容窗口）同时接受新旧两个 tag，并按每个旧 tag 打一次 deprecation 日志——这样所有 bot 实例升级完之前不会互相拒收。 |
