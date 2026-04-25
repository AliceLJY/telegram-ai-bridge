import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempHome() {
  const home = mkdtempSync(join(tmpdir(), "telegram-ai-bridge-launchd-"));
  tempDirs.push(home);
  mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
  return home;
}

describe("install-launch-agent", () => {
  test("uses the macOS standard log directory by default", () => {
    const home = makeTempHome();
    const result = Bun.spawnSync({
      cmd: ["bash", "scripts/install-launch-agent.sh", "--backend", "codex"],
      cwd: import.meta.dir + "/..",
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const plistPath = join(home, "Library", "LaunchAgents", "com.telegram-ai-bridge-codex.plist");
    const plist = readFileSync(plistPath, "utf8");

    expect(plist).toContain(join(home, "Library", "Logs", "telegram-ai-bridge", "bridge-codex.log"));
  });
});
