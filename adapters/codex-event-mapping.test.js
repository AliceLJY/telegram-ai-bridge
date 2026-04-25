import { describe, expect, test } from "bun:test";

import { createCodexEventState, finalizeCodexEventMapping, mapCodexEvent } from "./codex.js";

describe("Codex event mapping", () => {
  test("maps thread.started into a session_init event", () => {
    const state = createCodexEventState();

    expect(mapCodexEvent({ type: "thread.started", thread_id: "thread-1" }, state, { id: "fallback" })).toEqual([
      { type: "session_init", sessionId: "thread-1" },
    ]);
  });

  test("uses the last agent message as turn.completed result text", () => {
    const state = createCodexEventState();

    expect(mapCodexEvent({
      type: "item.completed",
      item: { type: "agent_message", text: "final answer" },
    }, state, { id: "thread-1" })).toEqual([
      { type: "session_init", sessionId: "thread-1" },
      { type: "progress", toolName: "message", detail: "final answer" },
    ]);
    expect(mapCodexEvent({ type: "turn.completed" }, state, { id: "thread-1" })).toEqual([
      { type: "result", success: true, text: "final answer", cost: null, duration: null },
    ]);
  });

  test("emits a final session_init fallback when the stream had no events", () => {
    const state = createCodexEventState();

    expect(finalizeCodexEventMapping(state, { id: "thread-fallback" })).toEqual([
      { type: "session_init", sessionId: "thread-fallback" },
    ]);
  });
});
