import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { defaultKnownCodexPaths, resolveCodexCommand } from "./codex-cli-resolver.js";

function writeFakeCodex(path, { version = "codex-cli 9.9.9", exitCode = 0 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\nprintf '${version}\\n'\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
}

describe("Codex CLI resolver", () => {
  test("prefers the ChatGPT app CLI on macOS", () => {
    expect(defaultKnownCodexPaths("darwin").slice(0, 2)).toEqual([
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
    ]);
  });

  test("uses the first working known path", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-resolver-priority-"));
    const chatgptCli = join(root, "ChatGPT.app", "Contents", "Resources", "codex");
    const homebrewCli = join(root, "homebrew", "bin", "codex");
    writeFakeCodex(chatgptCli, { version: "codex-cli chatgpt" });
    writeFakeCodex(homebrewCli, { version: "codex-cli homebrew" });

    expect(resolveCodexCommand({
      env: { PATH: "" },
      envKeys: [],
      knownPaths: [chatgptCli, homebrewCli],
    })).toEqual({
      path: chatgptCli,
      source: "known-path",
      version: "codex-cli chatgpt",
    });
  });

  test("falls back when an earlier known path is broken", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-resolver-fallback-"));
    const brokenAppCli = join(root, "ChatGPT.app", "Contents", "Resources", "codex");
    const homebrewCli = join(root, "homebrew", "bin", "codex");
    writeFakeCodex(brokenAppCli, { version: "broken", exitCode: 1 });
    writeFakeCodex(homebrewCli, { version: "codex-cli homebrew" });

    expect(resolveCodexCommand({
      env: { PATH: "" },
      envKeys: [],
      knownPaths: [brokenAppCli, homebrewCli],
    }).path).toBe(homebrewCli);
  });
});
