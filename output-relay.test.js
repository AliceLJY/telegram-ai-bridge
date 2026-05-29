import { describe, expect, test } from "bun:test";

import {
  detectCodeLang,
  estimateCodeRatio,
  extractFilePathsFromText,
  sanitizeBackendError,
  splitTelegramChunks,
} from "./output-relay.js";

describe("output relay helpers", () => {
  test("extracts existing absolute and home-relative file paths without duplicates", () => {
    const home = "/tmp/tg-bridge-home";
    const existingPaths = new Set([
      `${home}/Desktop/report.md`,
      "/tmp/tg-bridge-abs/result.png",
    ]);
    const files = [{ filePath: `${home}/Desktop/report.md`, source: "persisted" }];
    const exists = (path) => existingPaths.has(path);

    extractFilePathsFromText(
      `生成好了: ~/Desktop/report.md 和 /tmp/tg-bridge-abs/result.png，重复 ~/Desktop/report.md`,
      files,
      { home, exists },
    );

    expect(files).toEqual([
      { filePath: `${home}/Desktop/report.md`, source: "persisted" },
      { filePath: "/tmp/tg-bridge-abs/result.png", source: "text_scan" },
    ]);
  });

  test("detects code-heavy output and normalizes common code block languages", () => {
    const text = "说明\n```typescript\nconst value: string = 'ok';\n```\n";

    expect(estimateCodeRatio(text)).toBeGreaterThan(0.6);
    expect(detectCodeLang(text)).toBe("ts");
  });
});

describe("sanitizeBackendError", () => {
  test("collapses Codex network / TLS stderr into one human line, no raw trace", () => {
    const raw = [
      "Codex Exec exited with code 1: Reading prompt from stdin...",
      "ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed",
      "ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: tls handshake eof",
    ].join("\n");

    const out = sanitizeBackendError(raw);

    expect(out).toContain("连接中断");
    expect(out).toContain("完整日志见后台");
    expect(out).not.toContain("rmcp");
    expect(out).not.toContain("tls handshake");
    expect(out).not.toContain("websocket");
  });

  test("recognizes apply_patch stale context and thread-not-found together, hides file names", () => {
    const raw = [
      "apply_patch verification failed: Failed to find expected lines in /Users/x/.codex/memories/MEMORY.md",
      "failed to record rollout items: thread 019e5598-79cf-7412-8e99-4ab9ac7866d6 not found",
    ].join("\n");

    const out = sanitizeBackendError(raw);

    expect(out).toContain("上下文已过期");
    expect(out).toContain("短暂不一致");
    expect(out).not.toContain("MEMORY.md");
    expect(out).not.toContain("019e5598");
  });

  test("truncates unrecognized errors to the first line, never dumps the full trace", () => {
    const raw = "突然冒出来一个没见过的错误\n" + "stack frame ...\n".repeat(50);

    const out = sanitizeBackendError(raw);

    expect(out).toContain("突然冒出来一个没见过的错误");
    expect(out).toContain("完整日志见后台");
    expect(out).not.toContain("stack frame");
    expect(out.length).toBeLessThan(230);
  });

  test("returns a friendly placeholder for empty / nullish input", () => {
    expect(sanitizeBackendError("")).toBe("后端未返回错误详情");
    expect(sanitizeBackendError(null)).toBe("后端未返回错误详情");
    expect(sanitizeBackendError(undefined)).toBe("后端未返回错误详情");
  });
});

describe("splitTelegramChunks (A2A 长回复 / sendLong 共用的分段)", () => {
  test("returns a single chunk when text is within the limit", () => {
    expect(splitTelegramChunks("hello", 4000)).toEqual(["hello"]);
    const exact = "a".repeat(100);
    expect(splitTelegramChunks(exact, 100)).toEqual([exact]);
  });

  test("splits over-limit text into multiple chunks, each within the limit (no fences)", () => {
    const text = "段落。\n\n".repeat(2000);
    const chunks = splitTelegramChunks(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(500);
    }
  });

  test("preserves every original line across chunk boundaries", () => {
    const text = Array.from({ length: 300 }, (_, i) => `行${i}的内容`).join("\n");
    const chunks = splitTelegramChunks(text, 200);
    const joined = chunks.join("\n");
    for (let i = 0; i < 300; i++) {
      expect(joined).toContain(`行${i}的内容`);
    }
  });

  test("repairs unclosed code fences so each chunk has balanced ```", () => {
    const longCode = "x\n".repeat(2000); // ~4000 字符代码体，强制跨段
    const text = "前言\n```js\n" + longCode + "```\n结尾";
    const chunks = splitTelegramChunks(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const fences = (c.match(/^```/gm) || []).length;
      expect(fences % 2).toBe(0); // 每段代码块自洽闭合
    }
  });
});
