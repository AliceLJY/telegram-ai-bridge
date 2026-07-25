import { describe, expect, test } from "bun:test";

import { createAdapter } from "./codex.js";

describe("Codex adapter configuration", () => {
  test("exposes current reasoning levels and a config-following default", () => {
    const adapter = createAdapter({ cwd: "/tmp", model: "", serviceTier: "fast" });

    expect(adapter.availableEfforts().map((item) => item.id)).toEqual([
      "__default__",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(adapter.availableEfforts()[0].label).toContain("跟随 Codex 配置");
  });

  test("reports inherited and explicit model/effort settings accurately", () => {
    const adapter = createAdapter({ cwd: "/tmp", model: "", serviceTier: "fast" });

    expect(adapter.statusInfo()).toMatchObject({
      model: "跟随 Codex 配置",
      effort: "跟随 Codex 配置",
    });
    expect(adapter.statusInfo("gpt-5.6-sol", "ultra")).toMatchObject({
      model: "gpt-5.6-sol",
      effort: "ultra",
    });
  });

  test("reports app-server transport mode", () => {
    const adapter = createAdapter({ cwd: "/tmp", transport: "app-server" });

    expect(adapter.statusInfo()).toMatchObject({
      mode: "Codex app-server",
    });
  });
});
