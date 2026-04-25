import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createAdapter } from "./gemini.js";

const originalHome = process.env.HOME;
const tempDirs = [];

afterEach(() => {
  if (originalHome == null) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Gemini adapter", () => {
  test("listSessions returns an empty array when local session files are absent", async () => {
    const home = mkdtempSync(join(tmpdir(), "telegram-ai-bridge-gemini-"));
    tempDirs.push(home);
    process.env.HOME = home;

    const adapter = createAdapter();

    expect(await adapter.listSessions()).toEqual([]);
  });
});
