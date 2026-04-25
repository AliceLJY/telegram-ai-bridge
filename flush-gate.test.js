import { describe, expect, test } from "bun:test";

import { createFlushGate } from "./flush-gate.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("FlushGate", () => {
  test("merges messages that arrive in the idle batch window", async () => {
    const calls = [];
    const gate = createFlushGate({ batchDelayMs: 5 });
    const processFn = async (ctx, prompt) => calls.push({ ctx, prompt });

    await gate.enqueue(1, { ctx: "ctx-1", prompt: "one" }, processFn);
    await gate.enqueue(1, { ctx: "ctx-2", prompt: "two" }, processFn);
    await sleep(20);

    expect(calls).toEqual([
      { ctx: "ctx-2", prompt: "[消息 1]\none\n\n[消息 2]\ntwo" },
    ]);
  });

  test("buffers messages while processing and flushes them after the active task", async () => {
    const calls = [];
    const buffered = [];
    let releaseFirst;
    const firstDone = new Promise((resolve) => { releaseFirst = resolve; });
    const gate = createFlushGate({
      batchDelayMs: 1,
      onBuffered: async (chatId, ctx) => buffered.push({ chatId, ctx }),
    });
    const processFn = async (ctx, prompt) => {
      calls.push({ ctx, prompt });
      if (prompt === "first") await firstDone;
    };

    await gate.enqueue(1, { ctx: "ctx-1", prompt: "first" }, processFn);
    await sleep(10);
    await gate.enqueue(1, { ctx: "ctx-2", prompt: "second" }, processFn);

    expect(gate.getPendingCount(1)).toBe(1);
    expect(buffered).toEqual([{ chatId: 1, ctx: "ctx-2" }]);

    releaseFirst();
    await sleep(10);

    expect(calls).toEqual([
      { ctx: "ctx-1", prompt: "first" },
      { ctx: "ctx-2", prompt: "second" },
    ]);
  });

  test("keeps the processing buffer capped at maxBufferSize", async () => {
    let releaseFirst;
    const dropped = [];
    const firstDone = new Promise((resolve) => { releaseFirst = resolve; });
    const gate = createFlushGate({
      batchDelayMs: 1,
      maxBufferSize: 1,
      onDropped: async (chatId, ctx) => dropped.push({ chatId, ctx }),
    });
    const processFn = async (_ctx, prompt) => {
      if (prompt === "first") await firstDone;
    };

    await gate.enqueue(1, { ctx: "ctx-1", prompt: "first" }, processFn);
    await sleep(10);
    await gate.enqueue(1, { ctx: "ctx-2", prompt: "second" }, processFn);
    await gate.enqueue(1, { ctx: "ctx-3", prompt: "third" }, processFn);

    expect(gate.getPendingCount(1)).toBe(1);
    expect(dropped).toEqual([{ chatId: 1, ctx: "ctx-3" }]);

    releaseFirst();
    await sleep(10);
  });
});
