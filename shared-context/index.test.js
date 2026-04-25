import { describe, expect, test } from "bun:test";

import {
  __setSharedContextBackendForTest,
  getSharedContextStatus,
  writeSharedMessage,
} from "./index.js";

describe("shared context manager", () => {
  test("write failures are downgraded to status warnings", async () => {
    __setSharedContextBackendForTest({
      async write() {
        throw new Error("redis unavailable");
      },
    }, "redis");

    await expect(writeSharedMessage(-100, {
      source: "bot:@claude",
      text: "hello",
    })).resolves.toBeUndefined();

    expect(getSharedContextStatus().lastWriteError.message).toBe("redis unavailable");
  });
});
