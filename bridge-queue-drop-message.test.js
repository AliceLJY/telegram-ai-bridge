import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("queue drop copy", () => {
  test("tells the user when a message was not added to the full queue", () => {
    const bridgeSource = readFileSync(join(import.meta.dir, "bridge.js"), "utf8");

    expect(bridgeSource).toContain("队列已满，这条未加入");
  });
});
