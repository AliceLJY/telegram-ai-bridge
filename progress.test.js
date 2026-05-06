import { describe, expect, test } from "bun:test";

import { createProgressTracker } from "./progress.js";

describe("progress tracker", () => {
  test("can start typing without a visible progress message", async () => {
    const calls = [];
    const ctx = {
      api: {
        sendMessage: async (...args) => {
          calls.push(["sendMessage", ...args]);
          return { message_id: 123 };
        },
        sendChatAction: async (...args) => {
          calls.push(["sendChatAction", ...args]);
        },
        editMessageText: async (...args) => {
          calls.push(["editMessageText", ...args]);
        },
        deleteMessage: async (...args) => {
          calls.push(["deleteMessage", ...args]);
        },
      },
    };

    const progress = createProgressTracker(ctx, -100, 1, "CC");
    await progress.start({ visibleMessage: false });
    progress.processEvent({ type: "progress", toolName: "Read" });
    await progress.finish();

    expect(calls).toEqual([
      ["sendChatAction", -100, "typing"],
    ]);
  });
});
