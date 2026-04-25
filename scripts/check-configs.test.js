import { describe, expect, test } from "bun:test";

describe("check-configs", () => {
  test("checks config schema without printing placeholder tokens", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "scripts/check-configs.js", "config.example.json"],
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("config.example.json");
    expect(`${stdout}\n${stderr}`).not.toContain("replace-me");
  });
});
