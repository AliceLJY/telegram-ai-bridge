import { describe, expect, test } from "bun:test";

import { registerCommands } from "./index.js";

describe("command registration", () => {
  test("registers Telegram commands and callbacks behind one boundary", () => {
    const registered = { commands: [], callbacks: [] };
    const bot = {
      command: (name, handler) => registered.commands.push({ name, handler }),
      callbackQuery: (pattern, handler) => registered.callbacks.push({ pattern: String(pattern), handler }),
    };

    registerCommands(bot, {});

    expect(registered.commands.map((entry) => entry.name)).toEqual([
      "help",
      "discuss",
      "new",
      "cancel",
      "resume",
      "peek",
      "sessions",
      "status",
      "a2a",
      "tasks",
      "verbose",
      "model",
      "effort",
      "dir",
      "cron",
      "export",
      "doctor",
    ]);
    expect(registered.callbacks.map((entry) => entry.pattern)).toContain("stop");
    expect(registered.callbacks.map((entry) => entry.pattern)).toContain("/^resume:/");
    expect(registered.callbacks.map((entry) => entry.pattern)).toContain("/^perm:/");
  });

  // 回归：/doctor 曾因 idleMonitor 未解构直接 ReferenceError（注册名单测不出来，必须真调 handler）
  test("/doctor handler runs with full deps and forwards idleMonitor", async () => {
    const registered = { commands: [], callbacks: [] };
    const bot = {
      command: (name, handler) => registered.commands.push({ name, handler }),
      callbackQuery: (pattern, handler) => registered.callbacks.push({ pattern: String(pattern), handler }),
    };

    const idleMonitorMarker = { __marker: "idle-monitor" };
    const healthCheckCalls = [];
    registerCommands(bot, {
      ACTIVE_BACKENDS: ["claude"],
      adapters: {},
      a2aBus: null,
      cronManager: null,
      dirManager: { current: () => "/tmp" },
      idleMonitor: idleMonitorMarker,
      rateLimiter: null,
      runHealthCheck: async (opts) => {
        healthCheckCalls.push(opts);
        return "ok";
      },
      sharedContextConfig: null,
    });

    const doctor = registered.commands.find((entry) => entry.name === "doctor");
    const replies = [];
    await doctor.handler({
      chat: { id: 42 },
      reply: async (text) => {
        replies.push(text);
        return {};
      },
    });

    expect(healthCheckCalls.length).toBe(1);
    expect(healthCheckCalls[0].idleMonitor).toBe(idleMonitorMarker);
    expect(replies).toEqual(["ok"]);
  });
});
