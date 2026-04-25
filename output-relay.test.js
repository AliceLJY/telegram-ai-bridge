import { describe, expect, test } from "bun:test";

import { detectCodeLang, estimateCodeRatio, extractFilePathsFromText } from "./output-relay.js";

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
