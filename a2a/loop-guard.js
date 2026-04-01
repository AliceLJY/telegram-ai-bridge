// A2A Loop Guard — 五层防死循环
// 1. Generation 计数器（硬编码 >= 2 丢弃）
// 2. Cooldown（响应 A2A 后冷却期）
// 3. Rate limit（每 chat 每窗口最多 N 次）
// 4. Idempotency（SHA-256 去重）
// 5. AI 自主判断（在 prompt 层实现，不在这里）

import { IdempotencyStore, createFingerprint } from "./idempotency.js";

export class LoopGuard {
  constructor(config = {}) {
    this.maxGeneration = 2; // 硬编码，不可配置
    this.cooldownMs = config.cooldownMs ?? 60_000;
    this.maxResponsesPerWindow = config.maxResponsesPerWindow ?? 3;
    this.windowMs = config.windowMs ?? 300_000;

    this.idempotency = new IdempotencyStore({ defaultTtlSeconds: 300 });
    this.idempotency.startCleanup();

    // chatId -> lastResponseTs
    this.cooldowns = new Map();
    // chatId -> [ts, ts, ...]
    this.rateCounts = new Map();

    this.stats = {
      received: 0,
      allowed: 0,
      blockedGeneration: 0,
      blockedCooldown: 0,
      blockedRate: 0,
      blockedDuplicate: 0,
    };
  }

  /**
   * 判断是否应该处理这个 envelope
   * @param {object} envelope
   * @returns {{ allow: boolean, reason: string }}
   */
  shouldProcess(envelope) {
    this.stats.received += 1;

    // 层 1: Generation 硬上限
    if (typeof envelope.generation !== "number" || envelope.generation >= this.maxGeneration) {
      this.stats.blockedGeneration += 1;
      return { allow: false, reason: `generation ${envelope.generation} >= ${this.maxGeneration}` };
    }

    const chatId = envelope.chat_id;

    // 层 2: Cooldown
    const lastResponse = this.cooldowns.get(chatId);
    if (lastResponse && Date.now() - lastResponse < this.cooldownMs) {
      this.stats.blockedCooldown += 1;
      return { allow: false, reason: `cooldown active (${this.cooldownMs}ms)` };
    }

    // 层 3: Rate limit
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let counts = this.rateCounts.get(chatId) || [];
    counts = counts.filter((ts) => ts > windowStart);
    this.rateCounts.set(chatId, counts);

    if (counts.length >= this.maxResponsesPerWindow) {
      this.stats.blockedRate += 1;
      return { allow: false, reason: `rate limit ${this.maxResponsesPerWindow}/${this.windowMs}ms` };
    }

    // 层 4: Idempotency
    const fingerprint = createFingerprint(
      `${envelope.chat_id}:${envelope.sender}:${envelope.content}`
    );
    const dedup = this.idempotency.check(envelope.idempotency_key, fingerprint);
    if (dedup.status === "duplicate") {
      this.stats.blockedDuplicate += 1;
      return { allow: false, reason: "duplicate message" };
    }
    // conflict 也当新消息处理（内容不同）

    // 存储指纹
    this.idempotency.store(envelope.idempotency_key, fingerprint);

    this.stats.allowed += 1;
    return { allow: true, reason: "ok" };
  }

  /** 记录一次 A2A 触发的响应（更新 cooldown + rate） */
  recordResponse(chatId) {
    const now = Date.now();
    this.cooldowns.set(chatId, now);

    const counts = this.rateCounts.get(chatId) || [];
    counts.push(now);
    this.rateCounts.set(chatId, counts);
  }

  getStats() {
    return {
      ...this.stats,
      idempotency: this.idempotency.getStats(),
    };
  }

  stop() {
    this.idempotency.stopCleanup();
  }
}
