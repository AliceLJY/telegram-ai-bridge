import { describe, expect, test } from "bun:test";

import { classifyError, withRetry } from "./send-retry.js";

describe("classifyError — A2A / sendLong 的 withRetry 靠它区分可重试与不可重试", () => {
  test("400 chat-not-found → client_error（不可重试，避免重复发送）", () => {
    expect(classifyError({ error_code: 400, description: "Bad Request: chat not found" })).toBe("client_error");
  });

  test("429 → rate_limit、5xx → server_error（可重试）", () => {
    expect(classifyError({ error_code: 429, description: "Too Many Requests" })).toBe("rate_limit");
    expect(classifyError({ error_code: 503, description: "Service Unavailable" })).toBe("server_error");
  });

  test("网络类错误 → network（可重试）", () => {
    expect(classifyError({ message: "fetch failed: ECONNRESET" })).toBe("network");
  });
});

describe("withRetry — 不可重试错误必须只调用一次（A2A 回复不能重复刷群）", () => {
  test("400 chat-not-found：fn 恰好调用一次然后抛出，不重试", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw { error_code: 400, description: "Bad Request: chat not found" };
    };
    await expect(withRetry(fn)).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  test("成功路径：fn 调用一次并返回结果", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return "sent";
    };
    expect(await withRetry(fn)).toBe("sent");
    expect(calls).toBe(1);
  });
});
