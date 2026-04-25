import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("idle timeout copy", () => {
  test("does not claim the bridge auto-terminates work it has not aborted", () => {
    const bridgeSource = readFileSync(join(import.meta.dir, "bridge.js"), "utf8");

    expect(bridgeSource).toContain("仍在处理，可点 Stop 中止");
    expect(bridgeSource).not.toContain("已自动终止");
  });
});
