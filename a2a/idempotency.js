// A2A Idempotency Store — SHA-256 去重
// 移植自 openclaw-a2a-gateway/src/internal/idempotency.ts

import { createHash } from "node:crypto";

/** SHA-256 指纹 */
export function createFingerprint(payload) {
  return createHash("sha256").update(String(payload)).digest("hex");
}

export class IdempotencyStore {
  constructor(config = {}) {
    this.defaultTtlMs = (config.defaultTtlSeconds ?? 300) * 1000;
    this.entries = new Map();
    this.expiredCleaned = 0;
    this.timer = null;
  }

  /**
   * 检查 key 是否已处理
   * @returns {{ status: "new" } | { status: "duplicate" } | { status: "conflict" }}
   */
  check(key, fingerprint) {
    const entry = this.entries.get(key);
    if (!entry) return { status: "new" };

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.expiredCleaned += 1;
      return { status: "new" };
    }

    if (entry.fingerprint === fingerprint) {
      return { status: "duplicate" };
    }

    return { status: "conflict" };
  }

  /** 存储已处理的 key */
  store(key, fingerprint, ttlMs) {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const now = Date.now();
    this.entries.set(key, {
      fingerprint,
      createdAt: now,
      expiresAt: now + ttl,
    });
  }

  /** 清理过期条目 */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        this.expiredCleaned += 1;
      }
    }
  }

  getStats() {
    return { total: this.entries.size, expiredCleaned: this.expiredCleaned };
  }

  startCleanup(intervalMs = 60_000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.cleanup(), intervalMs);
  }

  stopCleanup() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
