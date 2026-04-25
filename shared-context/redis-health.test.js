import { describe, expect, test } from "bun:test";

import { checkRedisHealth } from "./redis-health.js";

describe("Redis health check", () => {
  test("skips ping for non-redis shared context backends", async () => {
    const health = await checkRedisHealth({ sharedContextBackend: "sqlite" });

    expect(health.checked).toBe(false);
  });

  test("reports a failed ping without throwing", async () => {
    const health = await checkRedisHealth({
      sharedContextBackend: "redis",
      redisUrl: "redis://127.0.0.1:9",
      timeoutMs: 50,
    });

    expect(health.checked).toBe(true);
    expect(health.ok).toBe(false);
    expect(health.error).toBeTruthy();
  });
});
