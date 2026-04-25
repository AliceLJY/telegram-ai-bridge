import { describe, expect, test } from "bun:test";

import { LoopGuard } from "./loop-guard.js";

function envelope(overrides = {}) {
  return {
    chat_id: -100,
    sender: "claude",
    content: "hello",
    idempotency_key: `key-${Math.random()}`,
    generation: 1,
    ...overrides,
  };
}

describe("LoopGuard", () => {
  test("allows generation below the hard boundary and blocks generation 2", () => {
    const guard = new LoopGuard();

    expect(guard.shouldProcess(envelope({ generation: 1 })).allow).toBe(true);
    expect(guard.shouldProcess(envelope({ generation: 2 })).allow).toBe(false);

    guard.stop();
  });

  test("blocks duplicate idempotency keys for identical content", () => {
    const guard = new LoopGuard();
    const msg = envelope({ idempotency_key: "same-key", content: "same content" });

    expect(guard.shouldProcess(msg).allow).toBe(true);
    expect(guard.shouldProcess(msg).reason).toBe("duplicate message");

    guard.stop();
  });

  test("keeps cooldown and rate limit marked as reserved, not active layers", () => {
    const guard = new LoopGuard({ cooldownMs: 60_000, maxResponsesPerWindow: 1 });
    guard.recordResponse(-100);

    const result = guard.shouldProcess(envelope({ content: "after reserved hook" }));
    const stats = guard.getStats();

    expect(result.allow).toBe(true);
    expect(stats.activeLayers).toEqual(["generation", "idempotency"]);
    expect(stats.reservedLayers).toEqual(["cooldown", "rate-limit"]);

    guard.stop();
  });
});
