import { describe, expect, test } from "bun:test";

import { mapAppServerNotification } from "./codex-app-server.js";

describe("Codex app-server event mapping", () => {
  test("maps thread and completed agent message notifications", () => {
    expect(mapAppServerNotification({
      method: "thread/started",
      params: { thread: { id: "thread-1" } },
    })).toEqual({
      type: "thread.started",
      thread_id: "thread-1",
    });

    expect(mapAppServerNotification({
      method: "item/completed",
      params: { item: { type: "agentMessage", text: "done" } },
    })).toEqual({
      type: "item.completed",
      item: { type: "agent_message", text: "done" },
    });
  });

  test("maps failed turns and server errors", () => {
    expect(mapAppServerNotification({
      method: "turn/completed",
      params: { turn: { status: "failed", error: { message: "failed" } } },
    })).toEqual({
      type: "turn.failed",
      error: { message: "failed" },
    });

    expect(mapAppServerNotification({
      method: "error",
      params: { error: { message: "network failed" } },
    })).toEqual({
      type: "error",
      message: "network failed",
    });
  });

  test("ignores unrelated app-server notifications", () => {
    expect(mapAppServerNotification({
      method: "thread/status/changed",
      params: { status: { type: "active" } },
    })).toBeNull();
    expect(mapAppServerNotification({
      method: "item/completed",
      params: { item: { type: "userMessage", content: [] } },
    })).toBeNull();
  });
});
