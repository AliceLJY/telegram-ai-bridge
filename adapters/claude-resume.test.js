import { describe, expect, test } from "bun:test";

import {
  hasQueuedCommandAfterLastTextUser,
  extractOrphanedQueuedPrompts,
  extractRecentTurns,
  hasFakeUserAfterLastRealUser,
  hasResumableHistory,
  detectFakeUserTurnInRecords,
} from "./claude.js";

describe("Claude resume safety", () => {
  test("flags transcripts where a queued command is newer than the last text user turn", () => {
    const records = [
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "上一条真实输入" }] },
      },
      {
        type: "attachment",
        attachment: {
          type: "queued_command",
          prompt: [{ type: "text", text: "这条会在 resume 时被延后消费" }],
        },
      },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "按旧状态回答" }] },
      },
    ];

    expect(hasQueuedCommandAfterLastTextUser(records)).toBe(true);
  });

  test("allows resume after a newer normal text user turn is recorded", () => {
    const records = [
      {
        type: "attachment",
        attachment: {
          type: "queued_command",
          prompt: [{ type: "text", text: "旧 queued command" }],
        },
      },
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "新一轮真实输入" }] },
      },
    ];

    expect(hasQueuedCommandAfterLastTextUser(records)).toBe(false);
  });

  test("does not treat tool_result user records as normal user text", () => {
    const records = [
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "上一条真实输入" }] },
      },
      {
        type: "attachment",
        attachment: {
          type: "queued_command",
          prompt: [{ type: "text", text: "延后输入" }],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
        },
      },
    ];

    expect(hasQueuedCommandAfterLastTextUser(records)).toBe(true);
  });
});

describe("extractOrphanedQueuedPrompts", () => {
  test("抓所有在最后一条 user text 之后的 commandMode=prompt（线上 string 形态）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "上一条真实输入" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "回复 1" }] } },
      { type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", prompt: "孤魂 1" } },
      { type: "attachment", attachment: { type: "queued_command", commandMode: "task-notification", prompt: "不该被抓" } },
      { type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", prompt: "孤魂 2" } },
    ];
    expect(extractOrphanedQueuedPrompts(records)).toEqual(["孤魂 1", "孤魂 2"]);
  });

  test("最后一条真 user text 之前的 queued 不抓（已被消费过）", () => {
    const records = [
      { type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", prompt: "已消费" } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "新输入" }] } },
    ];
    expect(extractOrphanedQueuedPrompts(records)).toEqual([]);
  });

  test("兼容数组形态 prompt（fixture 历史用过）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "上一条" }] } },
      {
        type: "attachment",
        attachment: {
          type: "queued_command",
          commandMode: "prompt",
          prompt: [{ type: "text", text: "数组形态孤魂" }],
        },
      },
    ];
    expect(extractOrphanedQueuedPrompts(records)).toEqual(["数组形态孤魂"]);
  });
});

describe("extractRecentTurns", () => {
  test("过滤 CLI 自注入的伪 user 'Continue from where you left off.'", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "真输入 1" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "回复 1" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "回复 2" }] } },
    ];
    const turns = extractRecentTurns(records, 6);
    const userTexts = turns.filter(t => t.role === "user").map(t => t.text);
    expect(userTexts).toEqual(["真输入 1"]);
    expect(turns).toHaveLength(3);
  });

  test("单轮超 perTurnCap 截尾 + 标 …[已截断]", () => {
    const longText = "x".repeat(2500);
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: longText }] } },
    ];
    const turns = extractRecentTurns(records, 6, 2000);
    expect(turns).toHaveLength(1);
    expect(turns[0].text.length).toBeLessThanOrEqual(2000 + "\n…[已截断]".length);
    expect(turns[0].text.endsWith("…[已截断]")).toBe(true);
  });

  test("按时间序保留最近 maxTurns 条", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "a" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "b" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "c" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "d" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "e" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "f" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "g" }] } },
    ];
    const turns = extractRecentTurns(records, 4);
    expect(turns.map(t => t.text)).toEqual(["d", "e", "f", "g"]);
  });

  test("跳过空 assistant content + 跳过 tool_result-only user", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "正常" }] } },
      { type: "assistant", message: { role: "assistant", content: [] } },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } },
    ];
    expect(extractRecentTurns(records, 6)).toHaveLength(1);
  });
});

describe("hasFakeUserAfterLastRealUser", () => {
  test("末尾真 user 之后没有伪 user → false", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "真话" }] } },
    ];
    expect(hasFakeUserAfterLastRealUser(records)).toBe(false);
  });

  test("末尾真 user 之后有伪 user → true", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "真话" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
    ];
    expect(hasFakeUserAfterLastRealUser(records)).toBe(true);
  });

  test("没有真 user 只有伪 user → true（伪 user 索引 > -1）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
    ];
    expect(hasFakeUserAfterLastRealUser(records)).toBe(true);
  });

  test("空 records → false", () => {
    expect(hasFakeUserAfterLastRealUser([])).toBe(false);
  });
});

describe("hasResumableHistory", () => {
  test("空 records → false", () => {
    expect(hasResumableHistory([])).toBe(false);
  });

  test("只有真 user 文本 → true（SDK 这次 resume 会注入伪 user）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "测试问题" }] } },
    ];
    expect(hasResumableHistory(records)).toBe(true);
  });

  test("只有 assistant 文本 → true（也算可 resume 的历史）", () => {
    const records = [
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "答案" }] } },
    ];
    expect(hasResumableHistory(records)).toBe(true);
  });

  test("只有伪 user → false（不算真历史，SDK 把这条当 resume 锚点）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
    ];
    expect(hasResumableHistory(records)).toBe(false);
  });

  test("只有 bridge 自喂提示（旧格式）→ false（避免自激活无限对冲）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "[Bridge 提示：上一轮的对冲" }] } },
    ];
    expect(hasResumableHistory(records)).toBe(false);
  });

  test("只有 bridge 自喂提示（新格式：真问题前置）→ false", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "【当前真实输入 — 这是用户此刻发来的独立新问题，请直接回答它】\n日本首都是哪里？\n\n────" }] } },
    ];
    expect(hasResumableHistory(records)).toBe(false);
  });

  test("只有 attachment / queued_command → false", () => {
    const records = [
      { type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", prompt: "x" } },
    ];
    expect(hasResumableHistory(records)).toBe(false);
  });

  test("空 assistant content → false（避免误判）", () => {
    const records = [
      { type: "assistant", message: { role: "assistant", content: [] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "   " }] } },
    ];
    expect(hasResumableHistory(records)).toBe(false);
  });

  test("混合：真 user + 伪 user + bridge 自喂 → true（真 user 命中）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "真问题" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "[Bridge 提示：xxx" }] } },
    ];
    expect(hasResumableHistory(records)).toBe(true);
  });
});

describe("detectFakeUserTurnInRecords (双 yield 兜底用)", () => {
  test("含'无 isMeta'伪 user → true（SDK 自起 turn 注入的孤魂）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
    ];
    expect(detectFakeUserTurnInRecords(records)).toBe(true);
  });

  test("含 isMeta=true 同款字符串 → false（SDK deferred tool resume 路径，不重跑）", () => {
    const records = [
      {
        type: "user",
        isMeta: true,
        message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] },
      },
    ];
    expect(detectFakeUserTurnInRecords(records)).toBe(false);
  });

  test("没有该字符串 → false", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "真问题" }] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "回答" }] } },
    ];
    expect(detectFakeUserTurnInRecords(records)).toBe(false);
  });

  test("空 records → false", () => {
    expect(detectFakeUserTurnInRecords([])).toBe(false);
  });

  test("attachment-only records → false", () => {
    const records = [
      { type: "attachment", attachment: { type: "deferred_tools_delta", addedNames: ["x"] } },
    ];
    expect(detectFakeUserTurnInRecords(records)).toBe(false);
  });

  test("assistant 含字面字符串 → false（assistant 不算 user）", () => {
    const records = [
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Continue from where you left off." }] },
      },
    ];
    expect(detectFakeUserTurnInRecords(records)).toBe(false);
  });

  test("混合：伪 user + 真 user → true（伪 user 命中即可）", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "真话" }] } },
    ];
    expect(detectFakeUserTurnInRecords(records)).toBe(true);
  });

  test("含 null / undefined 元素 → 不抛错", () => {
    const records = [null, undefined, { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } }];
    expect(detectFakeUserTurnInRecords(records)).toBe(true);
  });
});

describe("hasQueuedCommandAfterLastTextUser 伪 user 不污染 lastTextUserIndex", () => {
  test("真 user → 孤魂 → 伪 user 之后再来孤魂 → 仍命中 unsafe", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "真话 1" }] } },
      { type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", prompt: "孤魂 1" } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
      { type: "attachment", attachment: { type: "queued_command", commandMode: "prompt", prompt: "孤魂 2" } },
    ];
    // 修复前：伪 user 算 lastTextUserIndex=2，孤魂 2 在位置 3 > 2 仍命中
    // 修复后：lastTextUserIndex=0（只算真话 1），孤魂 1/2 都比它新，命中
    expect(hasQueuedCommandAfterLastTextUser(records)).toBe(true);
  });

  test("真 user → 伪 user → 没孤魂 → 不命中", () => {
    const records = [
      { type: "user", message: { role: "user", content: [{ type: "text", text: "真话" }] } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] } },
    ];
    expect(hasQueuedCommandAfterLastTextUser(records)).toBe(false);
  });
});
