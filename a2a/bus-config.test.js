import { describe, expect, test } from "bun:test";

import { createA2ABus } from "./bus.js";

describe("A2A bus config", () => {
  test("surfaces the effective circuit breaker settings in stats", () => {
    const bus = createA2ABus({
      selfName: "claude",
      port: 0,
      peers: {
        codex: "http://localhost:18811",
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 12000,
      },
    });

    expect(bus.getStats().circuitBreaker).toEqual({
      failureThreshold: 5,
      resetTimeoutMs: 12000,
    });
  });
});
