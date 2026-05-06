import { describe, expect, test } from "bun:test";

import {
  buildDiscussCommandResult,
  buildDiscussExitContractHint,
  formatDiscussSharedText,
  getDiscussTargeting,
  getDiscussTurnState,
  resolveDiscussResponse,
  shouldAllowBotDiscussDirectMessage,
  shouldForwardProgressEvent,
  shouldProbeDiscussMessage,
  shouldUsePersistentDiscussSession,
  shouldUseProgressIndicator,
  shouldUseStreamingPreview,
} from "./discuss-mode.js";

describe("discuss mode P1 contract", () => {
  const allowlistedGroup = { id: -100123, type: "supergroup" };
  const discussChatIds = new Set(["-100123"]);

  test("allowlisted group chats default to active discuss mode", () => {
    expect(getDiscussTurnState({
      chat: allowlistedGroup,
      session: null,
      discussChatIds,
    })).toMatchObject({
      active: true,
      sessionType: "discuss",
      configuredSessionType: "normal",
      sessionTypeExplicit: false,
    });

    expect(shouldProbeDiscussMessage({
      chat: allowlistedGroup,
      from: { id: 7, is_bot: false },
      session: { session_type: "normal", session_type_explicit: false },
      discussChatIds,
      text: "allowlisted 群普通消息默认进入 discuss 探测",
    })).toBe(true);
  });

  test("explicit normal session type disables default discuss mode", () => {
    expect(getDiscussTurnState({
      chat: allowlistedGroup,
      session: { session_type: "normal", session_type_explicit: true },
      discussChatIds,
    })).toMatchObject({
      active: false,
      sessionType: "normal",
      configuredSessionType: "normal",
      sessionTypeExplicit: true,
    });
  });

  test("active discuss mode requires group chat and allowlist", () => {
    expect(getDiscussTurnState({
      chat: allowlistedGroup,
      session: { session_type: "discuss" },
      discussChatIds,
    })).toMatchObject({ active: true });

    expect(getDiscussTurnState({
      chat: allowlistedGroup,
      session: { session_type: "normal", session_type_explicit: true },
      discussChatIds,
    })).toMatchObject({ active: false });

    expect(getDiscussTurnState({
      chat: { id: -100123, type: "private" },
      session: { session_type: "discuss" },
      discussChatIds,
    })).toMatchObject({ active: false });

    expect(getDiscussTurnState({
      chat: { id: -100999, type: "supergroup" },
      session: { session_type: "discuss" },
      discussChatIds,
    })).toMatchObject({ active: false });
  });

  test("streaming preview is disabled only for active discuss turns", () => {
    expect(shouldUseStreamingPreview({
      envEnabled: true,
      discussModeActive: true,
    })).toBe(false);

    expect(shouldUseStreamingPreview({
      envEnabled: true,
      discussModeActive: false,
    })).toBe(true);

    expect(shouldUseStreamingPreview({
      envEnabled: false,
      discussModeActive: false,
    })).toBe(false);
  });

  test("visible progress indicator is suppressed for active discuss turns", () => {
    expect(shouldUseProgressIndicator({
      discussModeActive: false,
    })).toBe(true);
    expect(shouldUseProgressIndicator({
      discussModeActive: true,
    })).toBe(false);
  });

  test("active discuss mode does not forward text events into progress rendering", () => {
    expect(shouldForwardProgressEvent({
      discussModeActive: true,
      event: { type: "text", text: "internal reasoning preview" },
    })).toBe(false);

    expect(shouldForwardProgressEvent({
      discussModeActive: true,
      event: { type: "progress", toolName: "Read" },
    })).toBe(true);

    expect(shouldForwardProgressEvent({
      discussModeActive: false,
      event: { type: "text", text: "normal preview" },
    })).toBe(true);
  });

  test("P2 probe gate only admits normal human text in active discuss mode", () => {
    expect(shouldProbeDiscussMessage({
      chat: allowlistedGroup,
      from: { id: 7, is_bot: false },
      session: { session_type: "discuss" },
      discussChatIds,
      text: "这条普通群消息可以让 discuss bot 自行判断是否静默",
    })).toBe(true);

    expect(shouldProbeDiscussMessage({
      chat: allowlistedGroup,
      from: { id: 7, is_bot: false },
      session: { session_type: "normal", session_type_explicit: true },
      discussChatIds,
      text: "普通模式仍然不探测",
    })).toBe(false);

    expect(shouldProbeDiscussMessage({
      chat: allowlistedGroup,
      from: { id: 7, is_bot: false },
      session: { session_type: "discuss" },
      discussChatIds,
      text: "/new@OtherBot",
    })).toBe(false);

    expect(shouldProbeDiscussMessage({
      chat: allowlistedGroup,
      from: { id: 99, is_bot: true },
      session: { session_type: "discuss" },
      discussChatIds,
      text: "bot messages should not trigger probe",
    })).toBe(false);
  });

  test("targeting detects this bot mention or reply without matching other bots", () => {
    expect(getDiscussTargeting({
      text: "请 @ccworker1_bot 接一下",
      botUsername: "ccworker1_bot",
      replyToBot: false,
    })).toEqual({
      direct: true,
      mentioned: true,
      replyToBot: false,
    });

    expect(getDiscussTargeting({
      text: "请 @ccworker12_bot 接一下",
      botUsername: "ccworker1_bot",
      replyToBot: false,
    })).toEqual({
      direct: false,
      mentioned: false,
      replyToBot: false,
    });

    expect(getDiscussTargeting({
      text: "继续上一条",
      botUsername: "ccworker1_bot",
      replyToBot: true,
    })).toEqual({
      direct: true,
      mentioned: false,
      replyToBot: true,
    });
  });

  test("bot messages can only trigger discuss when directly addressing this bot", () => {
    expect(shouldAllowBotDiscussDirectMessage({
      chat: allowlistedGroup,
      from: { id: 99, is_bot: true },
      session: { session_type: "discuss" },
      discussChatIds,
      text: "请 @cxworker2_bot 验证一下",
      botUsername: "cxworker2_bot",
    })).toBe(true);

    expect(shouldAllowBotDiscussDirectMessage({
      chat: allowlistedGroup,
      from: { id: 99, is_bot: true },
      session: { session_type: "discuss" },
      discussChatIds,
      text: "普通 bot 消息不应该触发",
      botUsername: "cxworker2_bot",
    })).toBe(false);

    expect(shouldAllowBotDiscussDirectMessage({
      chat: allowlistedGroup,
      from: { id: 7, is_bot: false },
      session: { session_type: "discuss" },
      discussChatIds,
      text: "human path is handled separately",
      botUsername: "cxworker2_bot",
    })).toBe(false);

    expect(shouldAllowBotDiscussDirectMessage({
      chat: allowlistedGroup,
      from: { id: 99, is_bot: true },
      session: { session_type: "normal", session_type_explicit: true },
      discussChatIds,
      text: "请 @cxworker2_bot 验证一下",
      botUsername: "cxworker2_bot",
    })).toBe(false);
  });

  test("discuss turns do not reuse or persist bot CLI sessions", () => {
    expect(shouldUsePersistentDiscussSession({
      discussModeActive: true,
      directAddressed: false,
    })).toBe(false);

    expect(shouldUsePersistentDiscussSession({
      discussModeActive: true,
      directAddressed: true,
    })).toBe(false);

    expect(shouldUsePersistentDiscussSession({
      discussModeActive: false,
      directAddressed: false,
    })).toBe(true);
  });

  test("action send posts only the JSON text in active discuss mode", () => {
    const turn = getDiscussTurnState({
      chat: allowlistedGroup,
      session: { session_type: "discuss" },
      discussChatIds,
    });
    const result = resolveDiscussResponse(
      '{"action":"send","text":"可以，这里需要先收束范围。","reply_to":123}',
      { active: turn.active },
    );

    expect(result).toMatchObject({
      action: "send",
      visibleText: "可以，这里需要先收束范围。",
      replyTo: 123,
      parsed: true,
    });
  });

  test("JSON-like send with unescaped inner quotes still posts only text", () => {
    const turn = getDiscussTurnState({
      chat: allowlistedGroup,
      session: { session_type: "discuss" },
      discussChatIds,
    });
    const result = resolveDiscussResponse(
      '{"action":"send","text":"你说的"身体累但精神回血"其实挺真的。\\n\\n拍到出片的没？"}',
      { active: turn.active },
    );

    expect(result).toMatchObject({
      action: "send",
      visibleText: '你说的"身体累但精神回血"其实挺真的。\n\n拍到出片的没？',
      parsed: false,
      fallback: "json_like_unescaped_string",
    });
  });

  test("action silent is invisible but keeps an internal shared-context marker", () => {
    const turn = getDiscussTurnState({
      chat: allowlistedGroup,
      session: { session_type: "discuss" },
      discussChatIds,
    });
    const result = resolveDiscussResponse(
      '{"action":"silent","reason":"no useful addition"}',
      { active: turn.active },
    );

    expect(result).toMatchObject({
      action: "silent",
      visibleText: "",
      reason: "no useful addition",
      parsed: true,
    });
    expect(formatDiscussSharedText(result)).toBe("[discuss:silent] no useful addition");
  });

  test("directly addressed discuss turns force a visible send if the model returns silent", () => {
    const result = resolveDiscussResponse(
      '{"action":"silent","reason":"no useful addition"}',
      { active: true, requireSend: true },
    );

    expect(result).toMatchObject({
      action: "send",
      parsed: true,
      fallback: "forced_direct_send",
    });
    expect(result.visibleText).toContain("我在");
  });

  test("invalid JSON falls back to visible send rather than silence", () => {
    const turn = getDiscussTurnState({
      chat: allowlistedGroup,
      session: { session_type: "discuss" },
      discussChatIds,
    });
    const rawText = "我认为这里应该直接回复，不应该静默。";
    const result = resolveDiscussResponse(rawText, { active: turn.active });

    expect(result).toMatchObject({
      action: "send",
      visibleText: rawText,
      parsed: false,
      fallback: "invalid_json",
    });
  });

  test("non-allowlisted groups keep old visible behavior", () => {
    const turn = getDiscussTurnState({
      chat: { id: -100999, type: "supergroup" },
      session: { session_type: "discuss" },
      discussChatIds,
    });
    const rawText = '{"action":"silent","reason":"normal chat should see this"}';
    const result = resolveDiscussResponse(rawText, { active: turn.active });

    expect(turn.active).toBe(false);
    expect(result).toMatchObject({
      action: "send",
      visibleText: rawText,
      parsed: false,
      fallback: "inactive",
    });
  });

  test("private chats keep old visible behavior even with discuss session type", () => {
    const turn = getDiscussTurnState({
      chat: { id: 42, type: "private" },
      session: { session_type: "discuss" },
      discussChatIds,
    });
    const rawText = '{"action":"silent","reason":"private chat should see this"}';
    const result = resolveDiscussResponse(rawText, { active: turn.active });

    expect(turn.active).toBe(false);
    expect(result).toMatchObject({
      action: "send",
      visibleText: rawText,
      parsed: false,
    });
  });

  test("owner /discuss on is handled as a command and does not submit to AI streaming", () => {
    const result = buildDiscussCommandResult({
      arg: "on",
      chat: allowlistedGroup,
      from: { id: 7 },
      ownerId: 7,
      session: { session_id: "session-123", session_type: "normal" },
      discussChatIds,
    });

    expect(result).toMatchObject({
      handled: true,
      ignored: false,
      shouldSubmitToAi: false,
      nextSessionType: "discuss",
    });
    expect(result.replyText).toContain("Discuss 模式已开启");
  });

  test("owner /discuss on can arm discuss mode before the first session exists", () => {
    const result = buildDiscussCommandResult({
      arg: "on",
      chat: allowlistedGroup,
      from: { id: 7 },
      ownerId: 7,
      session: null,
      discussChatIds,
    });

    expect(result).toMatchObject({
      handled: true,
      ignored: false,
      shouldSubmitToAi: false,
      nextSessionType: "discuss",
    });
    expect(result.replyText).toContain("Discuss 模式已开启");
  });

  test("owner /discuss off clears the current session type", () => {
    const result = buildDiscussCommandResult({
      arg: "off",
      chat: allowlistedGroup,
      from: { id: 7 },
      ownerId: 7,
      session: { session_id: "session-123", session_type: "discuss" },
      discussChatIds,
    });

    expect(result).toMatchObject({
      handled: true,
      shouldSubmitToAi: false,
      nextSessionType: "normal",
    });
    expect(result.replyText).toContain("已关闭");
  });

  test("non-owner /discuss command is ignored by control logic", () => {
    const result = buildDiscussCommandResult({
      arg: "on",
      chat: allowlistedGroup,
      from: { id: 8 },
      ownerId: 7,
      session: { session_id: "session-123", session_type: "normal" },
      discussChatIds,
    });

    expect(result).toMatchObject({
      handled: false,
      ignored: true,
      shouldSubmitToAi: false,
      nextSessionType: null,
      replyText: "",
    });
  });

  test("/discuss status explains blocked private and non-allowlisted chats", () => {
    expect(buildDiscussCommandResult({
      arg: "status",
      chat: { id: 42, type: "private" },
      from: { id: 7 },
      ownerId: 7,
      session: { session_id: "session-123", session_type: "discuss" },
      discussChatIds,
    }).replyText).toContain("保持普通模式");

    expect(buildDiscussCommandResult({
      arg: "status",
      chat: { id: -100999, type: "supergroup" },
      from: { id: 7 },
      ownerId: 7,
      session: { session_id: "session-123", session_type: "discuss" },
      discussChatIds,
    }).replyText).toContain("未在 DISCUSS_CHAT_IDS allowlist");
  });

  test("ambient discuss prompt hint requires send/silent self-selection", () => {
    const hint = buildDiscussExitContractHint({ botUsername: "ccworker1_bot" });

    expect(hint).toContain("默认保持静默");
    expect(hint).toContain("@ccworker1_bot");
    expect(hint).toContain("如果消息明确 @ 其他 bot");
    expect(hint).toContain('{"action":"send","text":"..."}');
    expect(hint).toContain('{"action":"silent","reason":"..."}');
    expect(hint).toContain("不要输出 JSON 之外的正文");
  });

  test("directly addressed discuss prompt forbids silent", () => {
    const hint = buildDiscussExitContractHint({
      botUsername: "ccworker1_bot",
      directAddressed: true,
    });

    expect(hint).toContain("本条消息明确点名或回复你");
    expect(hint).toContain("必须选择 send");
    expect(hint).toContain("禁止输出 silent");
    expect(hint).toContain("不要让位给其他 bot");
    expect(hint).toContain("不要只说");
    expect(hint).not.toContain('{"action":"silent","reason":"..."}');
  });
});
