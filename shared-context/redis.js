/**
 * Redis 后端 — LPUSH + LTRIM + EXPIRE，天然支持 TTL 和并发
 */
import Redis from "ioredis";
import { estimateTokens, trimByTokens } from "./utils.js";

export function createRedisBackend(config) {
  let redis = null;
  const prefix = "shared_ctx:";
  // Redis 端保留稍多，精确裁剪在 read 时做
  const maxListLen = (config.groupContextMaxMessages || 30) * 3;

  function chatKey(chatId) {
    return `${prefix}${chatId}`;
  }

  return {
    async init() {
      redis = new Redis(config.redisUrl || "redis://localhost:6379", {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      // 防止未捕获的 Redis error 杀掉进程
      redis.on("error", (err) => {
        console.error(`[shared-context:redis] Connection error: ${err.message}`);
      });

      await redis.connect();
    },

    async write(chatId, { source, backend = "", role = "assistant", text }) {
      if (!redis || !text) return;
      const entry = JSON.stringify({
        source,
        backend,
        role,
        text,
        tokens: estimateTokens(text),
        ts: Date.now(),
      });
      const key = chatKey(chatId);
      const ttlSec = Math.ceil((config.groupContextTtlMs || 1200000) / 1000);
      await redis.lpush(key, entry);
      await redis.ltrim(key, 0, maxListLen - 1);
      await redis.expire(key, ttlSec);
    },

    async read(chatId, { maxMessages = 30, maxTokens = 3000, ttlMs = 1200000 } = {}) {
      if (!redis) return [];
      const key = chatKey(chatId);
      const raw = await redis.lrange(key, 0, maxMessages - 1);

      const minTs = Date.now() - ttlMs;
      const entries = raw
        .map((s) => {
          try {
            return JSON.parse(s);
          } catch {
            return null;
          }
        })
        .filter((e) => e && e.ts >= minTs)
        .reverse(); // LPUSH 是倒序存的，反转成时间正序

      return trimByTokens(entries, maxTokens);
    },
  };
}
