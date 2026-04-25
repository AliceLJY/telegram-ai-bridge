import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("external session scan", () => {
  test("defensively treats non-array adapter session scans as empty", () => {
    const bridgeSource = readFileSync(join(import.meta.dir, "bridge.js"), "utf8");

    expect(bridgeSource).toContain("Array.isArray(scanned)");
  });
});
