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
      "new",
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
});
