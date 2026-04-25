import { describe, expect, test } from "bun:test";

import { runHealthCheck } from "./doctor.js";

describe("doctor", () => {
  test("reads A2A received count from loopGuard stats", async () => {
    const report = await runHealthCheck({
      a2aBus: {
        getStats: () => ({
          loopGuard: { received: 7 },
        }),
      },
    });

    expect(report).toContain("received=7");
  });
});
