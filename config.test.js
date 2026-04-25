import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import {
  applyRuntimeEnv,
  bootstrapWorkspace,
  createDefaultConfig,
  loadRuntimeConfig,
  resolveCliArgs,
  summarizeRuntime,
  validateConfig,
} from "./config.js";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "telegram-ai-bridge-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(configPath, mutate = null) {
  const config = createDefaultConfig();
  const workspaceDir = join(dirname(configPath), "workspace");
  const dataDir = join(dirname(configPath), "data");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  config.shared.ownerTelegramId = "123456789";
  config.shared.cwd = workspaceDir;
  config.shared.tasksDb = "data/tasks.db";
  config.backends.claude.enabled = true;
  config.backends.claude.telegramBotToken = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  config.backends.claude.sessionsDb = "data/sessions.db";
  config.backends.codex.enabled = false;
  config.backends.codex.telegramBotToken = "";
  config.backends.gemini.enabled = false;
  config.backends.gemini.telegramBotToken = "";

  if (mutate) mutate(config, { workspaceDir, dataDir });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { config, workspaceDir, dataDir };
}

describe("config productization", () => {
  test("bootstrapWorkspace creates starter config and files directory", () => {
    const repoDir = makeTempDir();
    const configPath = join(repoDir, "config.json");

    const result = bootstrapWorkspace({ backend: "codex", configPath });

    expect(result.created).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(join(repoDir, "files"))).toBe(true);

    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.backends.codex.enabled).toBe(true);
    expect(written.backends.claude.enabled).toBe(false);
    expect(written.backends.codex.telegramBotToken).toBe("123456:replace-me");
  });

  test("validateConfig reports invalid shared fields and duplicate bot tokens", () => {
    const config = createDefaultConfig();
    config.shared.ownerTelegramId = "not-a-number";
    config.shared.cwd = "";
    config.shared.tasksDb = "";
    config.shared.defaultVerboseLevel = 9;
    config.backends.claude.enabled = true;
    config.backends.claude.telegramBotToken = "123456:ABCDEFGHIJKLMN";
    config.backends.codex.enabled = true;
    config.backends.codex.telegramBotToken = "123456:ABCDEFGHIJKLMN";

    const issues = validateConfig(config);
    const paths = issues.map((issue) => issue.path);

    expect(paths).toContain("shared.ownerTelegramId");
    expect(paths).toContain("shared.cwd");
    expect(paths).toContain("shared.tasksDb");
    expect(paths).toContain("shared.defaultVerboseLevel");
    expect(paths).toContain("backends.codex.telegramBotToken");
  });

  test("validateConfig rejects unknown A2A tool modes", () => {
    const config = createDefaultConfig();
    config.shared.a2aToolMode = "dangerous";

    const issues = validateConfig(config);

    expect(issues.map((issue) => issue.path)).toContain("shared.a2aToolMode");
  });

  test("loadRuntimeConfig resolves config paths and summarizeRuntime redacts secrets", () => {
    const repoDir = makeTempDir();
    const configPath = join(repoDir, "config.json");
    const { workspaceDir, dataDir } = writeConfig(configPath, (config) => {
      config.shared.a2aToolMode = "full";
    });

    const runtime = loadRuntimeConfig({ backend: "claude", configPath });
    const summary = summarizeRuntime(runtime);

    expect(runtime.env.CC_CWD).toBe(workspaceDir);
    expect(runtime.env.SESSIONS_DB).toBe(join(dataDir, "sessions.db"));
    expect(runtime.env.TASKS_DB).toBe(join(dataDir, "tasks.db"));
    expect(runtime.env.A2A_TOOL_MODE).toBe("full");
    expect(summary.env.TELEGRAM_BOT_TOKEN).toBe("1234…WXYZ");
  });

  test("loadRuntimeConfig rejects configs whose working directory does not exist", () => {
    const repoDir = makeTempDir();
    const configPath = join(repoDir, "config.json");
    writeConfig(configPath, (config, { workspaceDir }) => {
      config.shared.cwd = join(workspaceDir, "missing");
    });

    expect(() => loadRuntimeConfig({ backend: "claude", configPath })).toThrow(/CC_CWD/);
  });

  test("loadRuntimeConfig requires config.json and no longer falls back to .env files", () => {
    const repoDir = makeTempDir();
    const configPath = join(repoDir, "config.json");

    expect(() => loadRuntimeConfig({ backend: "claude", configPath })).toThrow(/Missing config file/);
  });

  test("resolveCliArgs parses bootstrap flags", () => {
    const cli = resolveCliArgs([
      "bun",
      "start.js",
      "bootstrap",
      "--backend",
      "codex",
      "--config",
      "./tmp-config.json",
      "--force",
    ]);

    expect(cli.command).toBe("bootstrap");
    expect(cli.backend).toBe("codex");
    expect(cli.force).toBe(true);
    expect(cli.backendSpecified).toBe(true);
    expect(cli.configPath.endsWith("/tmp-config.json")).toBe(true);
  });

  test("applyRuntimeEnv overrides inherited backend selection", () => {
    const originalDefaultBackend = process.env.DEFAULT_BACKEND;
    const originalEnabledBackends = process.env.ENABLED_BACKENDS;
    const originalTelegramToken = process.env.TELEGRAM_BOT_TOKEN;

    process.env.DEFAULT_BACKEND = "codex";
    process.env.ENABLED_BACKENDS = "codex,gemini";
    process.env.TELEGRAM_BOT_TOKEN = "old-token";

    applyRuntimeEnv({
      DEFAULT_BACKEND: "claude",
      ENABLED_BACKENDS: "claude",
      TELEGRAM_BOT_TOKEN: "new-token",
    });

    expect(process.env.DEFAULT_BACKEND).toBe("claude");
    expect(process.env.ENABLED_BACKENDS).toBe("claude");
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe("new-token");

    if (originalDefaultBackend == null) delete process.env.DEFAULT_BACKEND;
    else process.env.DEFAULT_BACKEND = originalDefaultBackend;
    if (originalEnabledBackends == null) delete process.env.ENABLED_BACKENDS;
    else process.env.ENABLED_BACKENDS = originalEnabledBackends;
    if (originalTelegramToken == null) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalTelegramToken;
  });
});
