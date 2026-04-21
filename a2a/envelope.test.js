import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  ACCEPTED_PROTOCOL_VERSIONS,
  CURRENT_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSIONS,
  createEnvelope,
  validateEnvelope,
} from "./envelope.js";

function baseEnvelope(overrides = {}) {
  return {
    ...createEnvelope({
      sender: "claude",
      senderUsername: "claude_bot",
      chatId: -100,
      generation: 0,
      content: "hello",
    }),
    ...overrides,
  };
}

describe("createEnvelope", () => {
  test("stamps the current protocol tag", () => {
    const env = createEnvelope({ sender: "claude", chatId: -1, content: "x" });
    expect(env.protocol_version).toBe("a2a-tg/v1");
    expect(env.protocol_version).toBe(CURRENT_PROTOCOL_VERSION);
  });

  test("current tag is different from legacy tags", () => {
    expect(LEGACY_PROTOCOL_VERSIONS).not.toContain(CURRENT_PROTOCOL_VERSION);
    expect(ACCEPTED_PROTOCOL_VERSIONS).toContain(CURRENT_PROTOCOL_VERSION);
    for (const legacy of LEGACY_PROTOCOL_VERSIONS) {
      expect(ACCEPTED_PROTOCOL_VERSIONS).toContain(legacy);
    }
  });
});

describe("validateEnvelope protocol_version", () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("accepts the current a2a-tg/v1 tag without deprecation warning", () => {
    const env = baseEnvelope({ protocol_version: "a2a-tg/v1" });
    expect(validateEnvelope(env)).toBeNull();
    const legacyWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0] ?? "").includes("deprecation"),
    );
    expect(legacyWarns.length).toBe(0);
  });

  test("accepts legacy a2a/v1 tag and logs a deprecation warning", () => {
    const env = baseEnvelope({ protocol_version: "a2a/v1" });
    expect(validateEnvelope(env)).toBeNull();
    const legacyWarns = warnSpy.mock.calls.filter((call) => {
      const msg = String(call[0] ?? "");
      return msg.includes("deprecation") && msg.includes("a2a/v1");
    });
    expect(legacyWarns.length).toBeGreaterThanOrEqual(1);
  });

  test("rejects unknown tag with INVALID_VERSION", () => {
    const env = baseEnvelope({ protocol_version: "a2a/v2" });
    const result = validateEnvelope(env);
    expect(result).not.toBeNull();
    expect(result.code).toBe("INVALID_VERSION");
  });
});
