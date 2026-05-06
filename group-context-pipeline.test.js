import { describe, expect, test } from "bun:test";

import {
  adaptTelegramUpdate,
  reduceContext,
  renderContext,
} from "./group-context-pipeline.js";

function makeCtx(overrides = {}) {
  return {
    chat: { id: -1001, type: "supergroup" },
    from: { id: 42, username: "alice", is_bot: false },
    message: { message_id: 10, text: "hello <world>" },
    ...overrides,
  };
}

describe("group context pipeline", () => {
  test("adaptTelegramUpdate creates canonical group message events", () => {
    const event = adaptTelegramUpdate(makeCtx(), { nowTs: 1234 });

    expect(event).toMatchObject({
      type: "telegram_message",
      chatId: -1001,
      messageId: 10,
      role: "user",
      source: "user:@alice",
      text: "hello <world>",
      ts: 1234,
    });
    expect(event.tokens).toBeGreaterThan(0);
  });

  test("adaptTelegramUpdate ignores empty and non-group messages", () => {
    expect(adaptTelegramUpdate(makeCtx({ chat: { id: 42, type: "private" } }))).toBeNull();
    expect(adaptTelegramUpdate(makeCtx({ message: { message_id: 11, text: "   " } }))).toBeNull();
  });

  test("reduceContext deduplicates and enforces ttl, message, and token budgets", () => {
    const params = {
      maxMessages: 2,
      maxTokens: 6,
      ttlMs: 100,
      nowTs: 200,
    };
    const existing = [
      { messageId: 1, role: "user", source: "user:old", text: "expired", tokens: 1, ts: 50 },
      { messageId: 2, role: "user", source: "user:a", text: "one two three", tokens: 3, ts: 130 },
    ];
    const event = {
      type: "telegram_message",
      messageId: 3,
      role: "assistant",
      source: "bot:@bridge",
      text: "四五六七",
      tokens: 4,
      ts: 190,
    };

    const reduced = reduceContext(existing, event, params);

    expect(reduced).toEqual([event]);
    expect(reduceContext(reduced, event, params)).toEqual(reduced);
  });

  test("renderContext produces XML-like deterministic context and excludes current message", () => {
    const rendered = renderContext({
      memoryEntries: [
        { messageId: 10, role: "user", source: "user:@alice", text: "current message body", ts: 1000 },
        { messageId: 9, role: "assistant", source: "bot:@other", text: "needs <escape>", ts: 900 },
      ],
      sharedEntries: [
        { role: "assistant", source: "bot:@shared", text: "shared reply", ts: 950 },
      ],
      currentMessageId: 10,
      userPrompt: "answer me",
      nowTs: 1000,
      maxMessages: 10,
      maxTokens: 1000,
    });

    expect(rendered).toContain("<group_context");
    expect(rendered).toContain("<message role=\"assistant\" source=\"bot:@other\"");
    expect(rendered).toContain("needs &lt;escape&gt;");
    expect(rendered).toContain("shared reply");
    expect(rendered).not.toContain("current message body");
    expect(rendered).toContain("<current_trigger>");
    expect(rendered).toContain("answer me");
  });
});
