import { describe, expect, test } from "bun:test";

import { PeerHealthManager } from "./peer-health.js";

// peer-health 之前唯一相关的 bus-config.test.js 只断言配置回显，没调过一次状态机。
// 这里直测 closed → open → half-open → closed 的真实转移。
describe("PeerHealthManager — 三态熔断器状态机", () => {
  test("连续失败达到阈值后熔断打开（isAvailable 变 false）", () => {
    const ph = new PeerHealthManager(["claude"], { failureThreshold: 3, resetTimeoutMs: 10_000 });
    expect(ph.isAvailable("claude")).toBe(true);
    ph.recordFailure("claude");
    ph.recordFailure("claude");
    expect(ph.isAvailable("claude")).toBe(true); // 2 次未到阈值，仍 closed
    ph.recordFailure("claude");
    expect(ph.isAvailable("claude")).toBe(false); // 第 3 次 → open
  });

  test("冷却期过后转 half-open，只放行一个探针，探针成功后回 closed", async () => {
    const ph = new PeerHealthManager(["claude"], { failureThreshold: 1, resetTimeoutMs: 40 });
    ph.recordFailure("claude"); // 阈值 1 → 立即 open
    expect(ph.isAvailable("claude")).toBe(false);
    await new Promise((r) => setTimeout(r, 60)); // 等过冷却期
    expect(ph.isAvailable("claude")).toBe(true); // open → half-open，放行一个探针
    expect(ph.isAvailable("claude")).toBe(false); // half-open 期间第二个被挡
    ph.recordSuccess("claude"); // 探针成功 → closed
    expect(ph.isAvailable("claude")).toBe(true);
  });

  test("half-open 探针失败 → 回到 open", async () => {
    const ph = new PeerHealthManager(["claude"], { failureThreshold: 1, resetTimeoutMs: 40 });
    ph.recordFailure("claude");
    await new Promise((r) => setTimeout(r, 60));
    expect(ph.isAvailable("claude")).toBe(true); // half-open 放行
    ph.recordFailure("claude"); // 探针失败 → 回 open
    expect(ph.isAvailable("claude")).toBe(false);
  });

  test("未知 peer 默认放行（不阻断没登记的对端）", () => {
    const ph = new PeerHealthManager(["claude"]);
    expect(ph.isAvailable("unknown")).toBe(true);
  });
});
