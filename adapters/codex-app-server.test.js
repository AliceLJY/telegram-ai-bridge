import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";

import {
  isExpectedAppServerTurn,
  mapAppServerNotification,
  streamAppServerEvents,
} from "./codex-app-server.js";

const interleavedAppServer = String.raw`
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");

lines.on("line", line => {
  const message = JSON.parse(line);
  if (message.id == null) return;
  if (message.method === "initialize") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread-parent" } } });
    return;
  }
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-parent" } } });
    setImmediate(() => {
      send({ method: "item/completed", params: {
        threadId: "thread-child",
        turnId: "turn-child",
        item: { type: "agentMessage", text: "wrong child result" },
      } });
      send({ method: "turn/completed", params: {
        threadId: "thread-child",
        turn: { id: "turn-child", status: "completed" },
      } });
      send({ method: "item/completed", params: {
        threadId: "thread-parent",
        turnId: "turn-parent",
        item: { type: "agentMessage", text: "correct parent result" },
      } });
      send({ method: "turn/completed", params: {
        threadId: "thread-parent",
        turn: { id: "turn-parent", status: "completed" },
      } });
    });
  }
});
`;

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
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", text: "done" },
      },
    })).toEqual({
      type: "item.completed",
      thread_id: "thread-1",
      turn_id: "turn-1",
      item: { type: "agent_message", text: "done" },
    });
  });

  test("maps failed turns and server errors", () => {
    expect(mapAppServerNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "failed", error: { message: "failed" } },
      },
    })).toEqual({
      type: "turn.failed",
      thread_id: "thread-1",
      turn_id: "turn-1",
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

  test("keeps child-thread events out of the parent turn", () => {
    expect(isExpectedAppServerTurn({
      method: "item/completed",
      params: {
        threadId: "thread-child",
        turnId: "turn-child",
        item: { type: "agentMessage", text: "child result" },
      },
    }, "thread-parent", "turn-parent")).toBe(false);

    expect(isExpectedAppServerTurn({
      method: "item/completed",
      params: {
        threadId: "thread-parent",
        turnId: "turn-child",
        item: { type: "agentMessage", text: "other turn result" },
      },
    }, "thread-parent", "turn-parent")).toBe(false);

    expect(isExpectedAppServerTurn({
      method: "item/completed",
      params: { item: { type: "agentMessage", text: "unscoped result" } },
    }, "thread-parent", "turn-parent")).toBe(false);

    expect(isExpectedAppServerTurn({
      method: "turn/completed",
      params: {
        threadId: "thread-parent",
        turn: { id: "turn-parent", status: "completed" },
      },
    }, "thread-parent", "turn-parent")).toBe(true);
  });

  test("the stream ignores an interleaved child result and returns the parent result", async () => {
    const spawnFixture = () => spawn(process.execPath, ["-e", interleavedAppServer], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const events = [];

    for await (const entry of streamAppServerEvents({
      codexPath: "unused-in-test",
      prompt: "parent prompt",
      cwd: process.cwd(),
      spawnProcess: spawnFixture,
    })) {
      events.push(entry.event);
    }

    expect(events.filter(event => event.type === "item.completed").map(event => event.item.text))
      .toEqual(["correct parent result"]);
    expect(events.at(-1)?.type).toBe("turn.completed");
  });

  test("does not turn an interrupted turn into a successful completion", () => {
    expect(mapAppServerNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "interrupted" },
      },
    })).toEqual({
      type: "turn.interrupted",
      thread_id: "thread-1",
      turn_id: "turn-1",
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
