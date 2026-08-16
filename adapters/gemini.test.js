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
  test("is disabled: creating it throws with the account-safety reason", () => {
    const home = mkdtempSync(join(tmpdir(), "telegram-ai-bridge-gemini-"));
    tempDirs.push(home);
    process.env.HOME = home;

    expect(() => createAdapter()).toThrow(/piggybacks on Gemini CLI OAuth/);
    expect(() => createAdapter()).toThrow(/geminicli\.com\/docs\/resources\/faq/);
  });

  test("the disabled reason names agy and API keys as the supported paths", () => {
    expect(() => createAdapter()).toThrow(/agy/);
    expect(() => createAdapter()).toThrow(/Vertex AI/);
  });
});
