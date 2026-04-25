import { describe, expect, test } from "bun:test";

import { createA2AClaudeOverrides } from "./tool-mode.js";

describe("A2A tool mode", () => {
  test("defaults Claude A2A to read-only tools", () => {
    const overrides = createA2AClaudeOverrides();

    expect(overrides.permissionMode).toBe("dontAsk");
    expect(overrides.allowedTools).toEqual(["Read", "Grep", "Glob"]);
    expect(overrides.allowedTools).not.toContain("Bash");
    expect(overrides.allowedTools).not.toContain("WebFetch");
    expect(overrides.allowedTools).not.toContain("WebSearch");
  });

  test("full mode is explicit and keeps the old broader tool list", () => {
    const overrides = createA2AClaudeOverrides({ toolMode: "full" });

    expect(overrides.allowedTools).toEqual(["Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch"]);
  });
});
