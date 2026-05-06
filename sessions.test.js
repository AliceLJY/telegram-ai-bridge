import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tempDir = mkdtempSync(join(tmpdir(), "telegram-ai-bridge-sessions-"));
process.env.SESSIONS_DB = join(tempDir, "sessions.db");

const {
  getSession,
  getSessionType,
  getSessionTypeState,
  recentSessions,
  setSession,
  setSessionType,
} = await import("./sessions.js");

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("sessions session_type", () => {
  test("new sessions default to normal and can be marked as discuss", () => {
    setSession(1001, "session-normal", "normal session", "claude", "owned");

    expect(getSession(1001)).toMatchObject({
      session_id: "session-normal",
      backend: "claude",
      ownership: "owned",
      session_type: "normal",
    });
    expect(getSessionType(1001)).toBe("normal");
    expect(getSessionTypeState(1001)).toEqual({
      sessionType: "normal",
      explicit: false,
    });

    setSessionType(1001, "discuss");

    expect(getSessionType(1001)).toBe("discuss");
    expect(getSessionTypeState(1001)).toEqual({
      sessionType: "discuss",
      explicit: true,
    });
    expect(getSession(1001).session_type).toBe("discuss");
  });

  test("session type can be set before a session exists", () => {
    expect(getSession(1003)).toBeNull();

    expect(setSessionType(1003, "discuss")).toBe(1);

    expect(getSessionType(1003)).toBe("discuss");
    expect(getSessionTypeState(1003)).toEqual({
      sessionType: "discuss",
      explicit: true,
    });
    expect(getSession(1003)).toBeNull();
  });

  test("plain session creation does not make normal an explicit chat override", () => {
    setSession(1004, "session-implicit-normal", "implicit normal", "claude", "owned");

    expect(getSessionTypeState(1004)).toEqual({
      sessionType: "normal",
      explicit: false,
    });

    setSessionType(1004, "normal");

    expect(getSessionTypeState(1004)).toEqual({
      sessionType: "normal",
      explicit: true,
    });
  });

  test("recent sessions preserve session_type through history archive", () => {
    setSession(1002, "session-discuss", "discuss session", "claude", "owned", "discuss");
    setSession(1002, "session-next", "next session", "claude", "owned");

    const rows = recentSessions(10, { chatId: 1002, backend: "claude", ownership: "owned" });
    const byId = new Map(rows.map((row) => [row.session_id, row]));

    expect(byId.get("session-discuss").session_type).toBe("discuss");
    expect(byId.get("session-next").session_type).toBe("normal");
  });
});
