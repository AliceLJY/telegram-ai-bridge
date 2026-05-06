import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

async function writeConfigPair({ firstSharedDb, secondSharedDb }) {
  const dir = mkdtempSync(join(tmpdir(), "telegram-ai-bridge-configs-"));
  tempDirs.push(dir);

  const repoDir = import.meta.dir + "/..";
  const base = await Bun.file(join(repoDir, "config.example.json")).json();
  const makeConfig = (sharedContextDb, port) => ({
    ...base,
    shared: {
      ...base.shared,
      ownerTelegramId: "123456789",
      sharedContextBackend: "sqlite",
      sharedContextDb,
      discussChatIds: ["-100123"],
      a2aEnabled: false,
      a2aPorts: {
        ...base.shared.a2aPorts,
        claude: port,
      },
      tasksDb: `tasks-${port}.db`,
    },
    backends: {
      ...base.backends,
      claude: {
        ...base.backends.claude,
        telegramBotToken: `123456:${port}`,
        sessionsDb: `sessions-${port}.db`,
      },
    },
  });

  const first = join(dir, "config-a.json");
  const second = join(dir, "config-b.json");
  await Bun.write(first, JSON.stringify(makeConfig(firstSharedDb, 19001), null, 2));
  await Bun.write(second, JSON.stringify(makeConfig(secondSharedDb, 19002), null, 2));
  return { first, second };
}

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

  test("rejects sqlite discuss configs that share a chat but use separate shared context dbs", async () => {
    const { first, second } = await writeConfigPair({
      firstSharedDb: "shared-a.db",
      secondSharedDb: "shared-b.db",
    });

    const result = Bun.spawnSync({
      cmd: ["bun", "scripts/check-configs.js", first, second],
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new TextDecoder().decode(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("shared.sharedContextDb");
    expect(stderr).toContain("-100123");
  });

  test("allows sqlite discuss configs that share the same context db", async () => {
    const { first, second } = await writeConfigPair({
      firstSharedDb: "shared-room.db",
      secondSharedDb: "shared-room.db",
    });

    const result = Bun.spawnSync({
      cmd: ["bun", "scripts/check-configs.js", first, second],
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
  });
});
