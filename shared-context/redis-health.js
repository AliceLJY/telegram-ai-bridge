import Redis from "ioredis";

export async function checkRedisHealth(config = {}) {
  const backend = config.sharedContextBackend || "sqlite";
  if (backend !== "redis") {
    return { checked: false, ok: true, backend };
  }

  const redisUrl = config.redisUrl || "redis://localhost:6379";
  const timeoutMs = config.timeoutMs ?? 1000;
  const redis = new Redis(redisUrl, {
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  redis.on("error", () => {});

  try {
    await redis.connect();
    await redis.ping();
    return { checked: true, ok: true, backend, redisUrl };
  } catch (error) {
    return { checked: true, ok: false, backend, redisUrl, error: error.message };
  } finally {
    redis.disconnect();
  }
}
