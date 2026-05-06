const GROUP_CHAT_TYPES = new Set(["group", "supergroup"]);

function normalizeChatId(value) {
  return String(value ?? "").trim();
}

function normalizeBotUsername(value) {
  return String(value ?? "").trim().replace(/^@/, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDiscussChatIds(discussChatIds) {
  if (discussChatIds instanceof Set) {
    return new Set([...discussChatIds].map(normalizeChatId).filter(Boolean));
  }
  if (Array.isArray(discussChatIds)) {
    return new Set(discussChatIds.map(normalizeChatId).filter(Boolean));
  }
  if (typeof discussChatIds === "string") {
    return new Set(
      discussChatIds
        .split(",")
        .map(normalizeChatId)
        .filter(Boolean),
    );
  }
  return new Set();
}

export function getDiscussTargeting({
  text = "",
  botUsername = "",
  replyToBot = false,
} = {}) {
  const username = normalizeBotUsername(botUsername);
  const mentioned = username
    ? new RegExp(`(^|[^A-Za-z0-9_])@${escapeRegExp(username)}(?=$|[^A-Za-z0-9_])`, "i").test(String(text || ""))
    : false;

  return {
    direct: Boolean(mentioned || replyToBot),
    mentioned,
    replyToBot: Boolean(replyToBot),
  };
}

function stripJsonFence(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return match ? match[1].trim() : trimmed;
}

function fallbackSend(rawText, fallback) {
  return {
    action: "send",
    visibleText: rawText,
    rawText,
    parsed: false,
    fallback,
  };
}

function decodeLooseJsonString(value) {
  const escapes = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
  };
  return String(value ?? "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(["\\/bfnrt])/g, (_, ch) => escapes[ch] ?? ch);
}

function recoverJsonLikeDiscussResponse(rawText) {
  const body = stripJsonFence(rawText);
  const actionMatch = body.match(/^\s*\{\s*"action"\s*:\s*"(send|silent)"\s*,/i);
  if (!actionMatch) return null;

  const action = actionMatch[1].toLowerCase();
  const field = action === "send" ? "text" : "reason";
  const fieldMatch = new RegExp(`"${field}"\\s*:\\s*"`, "i").exec(body);
  if (!fieldMatch) return null;

  const rest = body.slice(fieldMatch.index + fieldMatch[0].length);
  const tailMatch = action === "send"
    ? rest.match(/^([\s\S]*)"\s*(?:,\s*"reply_to"\s*:\s*(-?\d+)\s*)?}\s*$/)
    : rest.match(/^([\s\S]*)"\s*}\s*$/);
  if (!tailMatch) return null;

  const value = decodeLooseJsonString(tailMatch[1]);
  if (action === "silent") {
    return {
      action: "silent",
      visibleText: "",
      rawText,
      parsed: false,
      fallback: "json_like_unescaped_string",
      reason: value.trim() || "no visible response",
    };
  }

  if (!value.trim()) {
    return {
      action: "silent",
      visibleText: "",
      rawText,
      parsed: false,
      fallback: "json_like_unescaped_string",
      reason: "empty send text",
    };
  }

  const replyTo = tailMatch[2] ? Number(tailMatch[2]) : null;
  return {
    action: "send",
    visibleText: value,
    rawText,
    parsed: false,
    fallback: "json_like_unescaped_string",
    replyTo: Number.isInteger(replyTo) ? replyTo : null,
  };
}

export function getDiscussTurnState({
  chat = null,
  session = null,
  discussChatIds = new Set(),
} = {}) {
  const allowedChatIds = normalizeDiscussChatIds(discussChatIds);
  const chatId = normalizeChatId(chat?.id);
  const isGroupChat = GROUP_CHAT_TYPES.has(chat?.type);
  const isAllowedChat = chatId && allowedChatIds.has(chatId);
  const configuredSessionType = String(session?.session_type || "normal").trim().toLowerCase() === "discuss"
    ? "discuss"
    : "normal";
  const sessionTypeExplicit = session?.session_type_explicit === true;
  const sessionType = isGroupChat && isAllowedChat && !sessionTypeExplicit && configuredSessionType === "normal"
    ? "discuss"
    : configuredSessionType;

  return {
    active: Boolean(isGroupChat && isAllowedChat && sessionType === "discuss"),
    isGroupChat,
    isAllowedChat: Boolean(isAllowedChat),
    sessionType,
    configuredSessionType,
    sessionTypeExplicit,
  };
}

function normalizeDiscussCommandArg(arg) {
  const value = String(arg ?? "").trim().toLowerCase();
  if (!value || value === "status") return "status";
  if (value === "on" || value === "off") return value;
  return "unknown";
}

function formatDiscussStatusLine(state) {
  if (!state.isGroupChat) return "chat=private_or_non_group";
  if (!state.isAllowedChat) return "chat=not_allowlisted";
  return `chat=allowlisted session_type=${state.sessionType}${state.sessionTypeExplicit ? "" : " default"}`;
}

export function buildDiscussCommandResult({
  arg = "",
  chat = null,
  from = null,
  ownerId = null,
  session = null,
  discussChatIds = new Set(),
} = {}) {
  const hasOwner = ownerId != null && String(ownerId).trim() !== "";
  if (hasOwner && String(from?.id ?? "") !== String(ownerId)) {
    return {
      handled: false,
      ignored: true,
      shouldSubmitToAi: false,
      replyText: "",
      nextSessionType: null,
    };
  }

  const command = normalizeDiscussCommandArg(arg);
  const state = getDiscussTurnState({ chat, session, discussChatIds });
  const base = {
    handled: true,
    ignored: false,
    shouldSubmitToAi: false,
    command,
    state,
    nextSessionType: null,
  };

  if (command === "unknown") {
    return {
      ...base,
      replyText: [
        "用法: /discuss status | /discuss on | /discuss off",
        `当前状态: ${state.active ? "on" : "off"} (${formatDiscussStatusLine(state)})`,
      ].join("\n"),
    };
  }

  if (!state.isGroupChat) {
    return {
      ...base,
      replyText: [
        "Discuss 模式只对 allowlist 群聊生效。",
        "当前是私聊或非群聊，保持普通模式。",
      ].join("\n"),
    };
  }

  if (!state.isAllowedChat) {
    return {
      ...base,
      replyText: [
        "当前群未在 DISCUSS_CHAT_IDS allowlist 中，保持普通模式。",
        "需要启用时先把本群 chat_id 加入 config.shared.discussChatIds 后重启。",
      ].join("\n"),
    };
  }

  if (command === "status") {
    return {
      ...base,
      replyText: [
        `Discuss 模式: ${state.active ? "on" : "off"}`,
        `Session type: ${state.sessionType}${state.sessionTypeExplicit ? "" : " (allowlist default)"}`,
        "用法: /discuss on | /discuss off | /discuss status",
      ].join("\n"),
    };
  }

  if (command === "on") {
    return {
      ...base,
      nextSessionType: "discuss",
      replyText: [
        "Discuss 模式已开启。",
        session?.session_id
          ? "后续本群当前 session 会按 JSON send/silent 契约处理。"
          : "下条触发消息会创建 discuss session，并按 JSON send/silent 契约处理。",
      ].join("\n"),
    };
  }

  return {
    ...base,
    nextSessionType: "normal",
    replyText: session?.session_id
      ? "Discuss 模式已关闭，当前 session 恢复普通输出。"
      : "Discuss 模式已关闭。",
  };
}

export function shouldProbeDiscussMessage({
  chat = null,
  from = null,
  session = null,
  discussChatIds = new Set(),
  text = "",
} = {}) {
  const turn = getDiscussTurnState({ chat, session, discussChatIds });
  const body = String(text || "").trim();
  if (!turn.active) return false;
  if (!body) return false;
  if (body.startsWith("/")) return false;
  if (from?.is_bot) return false;
  return true;
}

export function shouldAllowBotDiscussDirectMessage({
  chat = null,
  from = null,
  session = null,
  discussChatIds = new Set(),
  text = "",
  botUsername = "",
  replyToBot = false,
} = {}) {
  if (!from?.is_bot) return false;
  const body = String(text || "").trim();
  if (!body || body.startsWith("/")) return false;

  const turn = getDiscussTurnState({ chat, session, discussChatIds });
  if (!turn.active) return false;

  const targeting = getDiscussTargeting({ text: body, botUsername, replyToBot });
  return targeting.direct;
}

export function shouldUseStreamingPreview({
  envEnabled = true,
  discussModeActive = false,
} = {}) {
  return Boolean(envEnabled) && !discussModeActive;
}

export function shouldUseProgressIndicator({
  discussModeActive = false,
} = {}) {
  return !discussModeActive;
}

export function shouldUsePersistentDiscussSession({
  discussModeActive = false,
} = {}) {
  return !discussModeActive;
}

export function shouldForwardProgressEvent({
  discussModeActive = false,
  event = null,
} = {}) {
  return !(discussModeActive && event?.type === "text");
}

export function buildDiscussExitContractHint({
  botUsername = "",
  directAddressed = false,
} = {}) {
  const username = normalizeBotUsername(botUsername);
  const identityLine = username ? `你的 Telegram bot username 是 @${username}。` : "";
  const triggerLines = directAddressed
    ? [
      "本条消息明确点名或回复你：你必须选择 send 并直接回答当前触发消息。",
      "禁止输出 silent；不要因为“没有新增价值”而静默，也不要让位给其他 bot。",
      "不要只说“我在”“收到”“这条我来接”；必须给出实质回答。",
    ]
    : [
      "默认保持静默；只有被明确点名、被回复，或你有明显新增价值时才发言。",
      "如果消息明确 @ 其他 bot，不等于点名你；你仍按普通旁观消息自行判断。",
    ];

  return [
    "[系统提示: 当前是群聊 Discuss 模式。你的最终输出必须是单个 JSON 对象。",
    identityLine,
    ...triggerLines,
    directAddressed ? "" : "如果只是旁观、重复别人、确认收悉、或没有必要参与，一律选择 silent。",
    '需要发言时只输出 {"action":"send","text":"..."}。',
    directAddressed ? "" : '需要静默时只输出 {"action":"silent","reason":"..."}。',
    "不要输出 JSON 之外的正文、Markdown 代码块或解释。]",
    "",
  ].filter(Boolean).join("\n");
}

export function resolveDiscussResponse(rawText, { active = false, requireSend = false } = {}) {
  const text = String(rawText ?? "");
  if (!active) return fallbackSend(text, "inactive");

  if (!text.trim()) {
    return {
      action: "silent",
      visibleText: "",
      rawText: text,
      parsed: false,
      fallback: "empty_text",
      reason: "empty response",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    return recoverJsonLikeDiscussResponse(text) || fallbackSend(text, "invalid_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fallbackSend(text, "invalid_json");
  }

  const action = String(parsed.action || "").trim().toLowerCase();
  if (action === "silent") {
    const reason = String(parsed.reason || "no visible response").trim() || "no visible response";
    if (requireSend) {
      return {
        action: "send",
        visibleText: "我在，这条我来接。",
        rawText: text,
        parsed: true,
        fallback: "forced_direct_send",
        reason,
      };
    }

    return {
      action: "silent",
      visibleText: "",
      rawText: text,
      parsed: true,
      reason,
    };
  }

  if (action === "send") {
    const visibleText = String(parsed.text ?? "");
    if (!visibleText.trim()) {
      return {
        action: "silent",
        visibleText: "",
        rawText: text,
        parsed: true,
        reason: "empty send text",
      };
    }

    return {
      action: "send",
      visibleText,
      rawText: text,
      parsed: true,
      replyTo: Number.isInteger(parsed.reply_to) ? parsed.reply_to : null,
    };
  }

  return fallbackSend(text, "unsupported_action");
}

export function formatDiscussSharedText(result) {
  if (!result) return "";
  if (result.action === "silent") {
    return `[discuss:silent] ${result.reason || "no visible response"}`;
  }
  return result.visibleText || "";
}
