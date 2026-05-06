import { describe, expect, test } from "bun:test";

import {
  isCommandForAnotherBot,
  parseMentionFirstCommand,
  parseTelegramCommandTarget,
} from "./telegram-command-routing.js";

describe("Telegram command routing", () => {
  test("parses slash commands with optional bot target", () => {
    expect(parseTelegramCommandTarget("/new@agent_c_bot")).toEqual({
      command: "new",
      targetUsername: "agent_c_bot",
    });
    expect(parseTelegramCommandTarget("/discuss@agent_d_bot status")).toEqual({
      command: "discuss",
      targetUsername: "agent_d_bot",
    });
    expect(parseTelegramCommandTarget("/status")).toEqual({
      command: "status",
      targetUsername: null,
    });
  });

  test("detects commands addressed to a different bot case-insensitively", () => {
    expect(isCommandForAnotherBot("/new@agent_c_bot", "agent_d_bot")).toBe(true);
    expect(isCommandForAnotherBot("/new@agent_d_bot", "agentd_bot")).toBe(false);
    expect(isCommandForAnotherBot("/new", "agent_d_bot")).toBe(false);
    expect(isCommandForAnotherBot("hello @Other_bot", "agent_d_bot")).toBe(false);
  });

  test("parses mention-first commands addressed to this bot", () => {
    expect(parseMentionFirstCommand("@agent_d_bot /discuss on", "agent_d_bot")).toEqual({
      command: "discuss",
      targetUsername: "agent_d_bot",
      args: "on",
    });
    expect(parseMentionFirstCommand("@agentd_bot /discuss@agent_d_bot status", "agent_d_bot")).toEqual({
      command: "discuss",
      targetUsername: "agent_d_bot",
      args: "status",
    });
    expect(parseMentionFirstCommand("@Other_bot /discuss on", "agent_d_bot")).toBeNull();
    expect(parseMentionFirstCommand("@agent_d_bot hello", "agent_d_bot")).toBeNull();
  });
});
