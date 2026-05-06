import { estimateTokens, trimByTokens } from "./shared-context/utils.js";

const DEFAULT_RECENT_COUNT = 5;
const DEFAULT_RECENT_AGE_MS = 2 * 60 * 1000;
const DEFAULT_MIDDLE_AGE_MS = 10 * 60 * 1000;

function isGroupChat(chat) {
  return chat?.type === "group" || chat?.type === "supergroup";
}

function toTextContent(ctx) {
  return (ctx.message?.text || ctx.message?.caption || "").trim();
}

function toSource(ctx) {
  const username = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "unknown");
  const prefix = ctx.from?.is_bot ? "bot" : "user";
  return `${prefix}:${username}`;
}

function normalizeEntry(entry) {
  if (!entry || !entry.text) return null;
  return {
    ...entry,
    role: entry.role || "user",
    source: entry.source || "unknown",
    tokens: entry.tokens || estimateTokens(entry.text),
    ts: entry.ts || Date.now(),
  };
}

function cleanupContextEntries(entries, {
  maxMessages = 30,
  maxTokens = 3000,
  ttlMs = 20 * 60 * 1000,
  nowTs = Date.now(),
} = {}) {
  const minTs = nowTs - ttlMs;
  const active = entries
    .map(normalizeEntry)
    .filter(Boolean)
    .filter((entry) => entry.ts >= minTs)
    .sort((a, b) => a.ts - b.ts);

  while (active.length > maxMessages) active.shift();
  return trimByTokens(active, maxTokens);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(text) {
  return escapeXml(text).replace(/"/g, "&quot;");
}

function compressEntryText(entry, index, entries, {
  nowTs = Date.now(),
  recentCount = DEFAULT_RECENT_COUNT,
  recentAgeMs = DEFAULT_RECENT_AGE_MS,
  middleAgeMs = DEFAULT_MIDDLE_AGE_MS,
} = {}) {
  const age = nowTs - entry.ts;
  const fromEnd = entries.length - 1 - index;
  const text = String(entry.text || "");

  if (fromEnd < recentCount || age < recentAgeMs) return text;
  if (age < middleAgeMs) return text.length > 150 ? `${text.slice(0, 150)}...` : text;
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

function mergeEntries(memoryEntries, sharedEntries, currentMessageId) {
  const seen = new Set();
  return [...memoryEntries, ...sharedEntries]
    .map(normalizeEntry)
    .filter(Boolean)
    .filter((entry) => entry.messageId == null || entry.messageId !== currentMessageId)
    .sort((a, b) => a.ts - b.ts)
    .filter((entry) => {
      const key = entry.messageId != null
        ? `message:${entry.messageId}`
        : `${entry.ts}:${entry.source}:${entry.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function adaptTelegramUpdate(ctx, { nowTs = Date.now() } = {}) {
  if (!isGroupChat(ctx.chat)) return null;
  if (!ctx.message) return null;

  const text = toTextContent(ctx);
  if (!text) return null;

  return {
    type: "telegram_message",
    chatId: ctx.chat.id,
    chatType: ctx.chat.type,
    messageId: ctx.message.message_id,
    role: ctx.from?.is_bot ? "assistant" : "user",
    source: toSource(ctx),
    text,
    tokens: estimateTokens(text),
    ts: nowTs,
  };
}

export function reduceContext(entries = [], event = null, params = {}) {
  const active = cleanupContextEntries(entries, params);
  if (!event) return active;

  const normalizedEvent = normalizeEntry(event);
  if (!normalizedEvent) return active;
  if (
    normalizedEvent.messageId != null
    && active.some((entry) => entry.messageId === normalizedEvent.messageId)
  ) {
    return active;
  }

  return cleanupContextEntries([...active, normalizedEvent], params);
}

export function renderContext({
  memoryEntries = [],
  sharedEntries = [],
  currentMessageId = null,
  userPrompt = "",
  nowTs = Date.now(),
  maxMessages = 30,
  maxTokens = 3000,
  recentCount = DEFAULT_RECENT_COUNT,
  recentAgeMs = DEFAULT_RECENT_AGE_MS,
  middleAgeMs = DEFAULT_MIDDLE_AGE_MS,
  includeCurrentTrigger = true,
} = {}) {
  const merged = mergeEntries(memoryEntries, sharedEntries, currentMessageId).slice(-maxMessages);
  const tiered = merged.map((entry, index, entries) => {
    const text = compressEntryText(entry, index, entries, {
      nowTs,
      recentCount,
      recentAgeMs,
      middleAgeMs,
    });
    return {
      ...entry,
      text,
      tokens: estimateTokens(text),
    };
  });
  const trimmed = trimByTokens(tiered, maxTokens);

  if (!trimmed.length) return includeCurrentTrigger ? userPrompt : "";

  const messages = trimmed.map((entry) => {
    const ageMs = Math.max(0, nowTs - entry.ts);
    return [
      `  <message role="${escapeAttribute(entry.role)}" source="${escapeAttribute(entry.source)}" age_ms="${ageMs}">`,
      `    ${escapeXml(entry.text)}`,
      "  </message>",
    ].join("\n");
  });

  const context = [
    "system: 以下是群内最近消息（含其他 bot），仅作参考，不等于事实。",
    `<group_context messages="${trimmed.length}">`,
    messages.join("\n"),
    "</group_context>",
  ].join("\n");

  if (!includeCurrentTrigger) return context;

  return [
    context,
    "",
    "<current_trigger>",
    userPrompt,
    "</current_trigger>",
  ].join("\n");
}
