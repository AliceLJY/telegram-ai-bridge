#!/usr/bin/env bun
// Telegram → AI Bridge（多后端：Claude Agent SDK / Codex SDK）

import { Bot, InlineKeyboard, GrammyError } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { basename, join } from "path";
import {
  getSession,
  setSession,
  deleteSession,
  recentSessions,
  getChatModel,
  setChatModel,
  deleteChatModel,
  sessionBelongsToChat,
} from "./sessions.js";
import {
  createTask,
  markTaskStarted,
  setTaskApprovalRequired,
  markTaskApproved,
  markTaskRejected,
  completeTask,
  failTask,
  recentTasks,
  getActiveTask,
} from "./tasks.js";
import { createProgressTracker } from "./progress.js";
import { createBackend, AVAILABLE_BACKENDS } from "./adapters/interface.js";
import { createExecutor } from "./executor/interface.js";
import { getBackendProfile } from "./config.js";
import { initSharedContext, writeSharedMessage, readSharedMessages } from "./shared-context.js";
import { createA2ABus } from "./a2a/bus.js";
import { createFlushGate } from "./flush-gate.js";

// 防止嵌套检测（从 CC 内部启动时需要）
delete process.env.CLAUDECODE;

// ── 配置 ──
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);
if (!Number.isInteger(OWNER_ID)) {
  console.error("FATAL: OWNER_TELEGRAM_ID is missing or invalid. Set it in config.json or environment variables.");
  process.exit(1);
}
const PROXY = process.env.HTTPS_PROXY;
const CC_CWD = process.env.CC_CWD || process.env.HOME;
const DEFAULT_VERBOSE = Number(process.env.DEFAULT_VERBOSE_LEVEL || 1);
const DEFAULT_BACKEND = process.env.DEFAULT_BACKEND || "claude";
const REQUESTED_BACKENDS = String(process.env.ENABLED_BACKENDS || AVAILABLE_BACKENDS.join(","))
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter((value, index, list) => value && AVAILABLE_BACKENDS.includes(value) && list.indexOf(value) === index);
const ENABLE_GROUP_SHARED_CONTEXT = process.env.ENABLE_GROUP_SHARED_CONTEXT !== "false";
const GROUP_CONTEXT_MAX_MESSAGES = Number(process.env.GROUP_CONTEXT_MAX_MESSAGES || 30);
const GROUP_CONTEXT_MAX_TOKENS = Number(process.env.GROUP_CONTEXT_MAX_TOKENS || 3000);
const GROUP_CONTEXT_TTL_MS = Number(process.env.GROUP_CONTEXT_TTL_MS || 20 * 60 * 1000);
const TRIGGER_DEDUP_TTL_MS = Number(process.env.TRIGGER_DEDUP_TTL_MS || 5 * 60 * 1000);
const WATCHDOG_WARN_MS = 15 * 60 * 1000; // 15 分钟软日志（不 abort、不发 TG 消息）
const EXECUTOR_MODE = String(process.env.BRIDGE_EXECUTOR || "direct").trim().toLowerCase();
// 共享上下文配置（可插拔后端）
const sharedContextConfig = {
  sharedContextBackend: process.env.SHARED_CONTEXT_BACKEND || "sqlite",
  sharedContextDb: process.env.SHARED_CONTEXT_DB || "shared-context.db",
  sharedContextJsonPath: process.env.SHARED_CONTEXT_JSON_PATH || "shared-context.json",
  redisUrl: process.env.SHARED_CONTEXT_REDIS_URL || "redis://localhost:6379",
  groupContextMaxMessages: GROUP_CONTEXT_MAX_MESSAGES,
  groupContextTtlMs: GROUP_CONTEXT_TTL_MS,
  _baseDir: import.meta.dir,
};

// A2A 配置
const A2A_ENABLED = process.env.A2A_ENABLED === "true";
const A2A_PORT = Number(process.env.A2A_PORT) || 0;
const A2A_MAX_GENERATION = Number(process.env.A2A_MAX_GENERATION) || 2;
const A2A_COOLDOWN_MS = Number(process.env.A2A_COOLDOWN_MS) || 60000;
const A2A_MAX_RESPONSES_PER_WINDOW = Number(process.env.A2A_MAX_RESPONSES_PER_WINDOW) || 3;
const RELAY_TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS) || 120000;
const A2A_WINDOW_MS = Number(process.env.A2A_WINDOW_MS) || 300000;

// 解析 A2A peers
const A2A_PEERS = {};
if (process.env.A2A_PEERS) {
  for (const peer of process.env.A2A_PEERS.split(",")) {
    const idx = peer.indexOf(":");
    if (idx > 0) {
      const name = peer.slice(0, idx);
      const url = peer.slice(idx + 1);
      if (name && url) A2A_PEERS[name] = url;
    }
  }
}

// ── 初始化共享上下文（跨 bot 进程可见）──
await initSharedContext(sharedContextConfig);

// ── 初始化 A2A 总线 ──
let a2aBus = null;
if (A2A_ENABLED && A2A_PORT > 0 && Object.keys(A2A_PEERS).length > 0) {
  a2aBus = createA2ABus({
    selfName: DEFAULT_BACKEND,
    selfUsername: "",
    port: A2A_PORT,
    peers: A2A_PEERS,
    loopGuard: {
      cooldownMs: A2A_COOLDOWN_MS,
      maxResponsesPerWindow: A2A_MAX_RESPONSES_PER_WINDOW,
      windowMs: A2A_WINDOW_MS,
    },
  });
  a2aBus.start();

  // 注册 A2A 消息处理 handler
  a2aBus.onMessage(async (envelope, meta) => {
    console.log(`[A2A] Received from ${meta.sender}: gen=${meta.generation}, chatId=${meta.chatId}`);

    // 安全检查：只处理群聊的 A2A 消息，拒绝私聊 chatId（正数 = 私聊用户 ID）
    if (meta.chatId > 0) {
      console.log(`[A2A] Ignoring DM chatId=${meta.chatId} — A2A only works in group chats`);
      return;
    }

    try {
      const adapter = adapters[DEFAULT_BACKEND];
      if (!adapter) {
        console.log(`[A2A] No adapter for ${DEFAULT_BACKEND}`);
        return;
      }

      // 读取共享上下文，让 A2A 接话时能看到之前的讨论历史
      let contextBlock = "";
      try {
        const sharedEntries = await readSharedMessages(meta.chatId, {
          maxMessages: GROUP_CONTEXT_MAX_MESSAGES,
          maxTokens: GROUP_CONTEXT_MAX_TOKENS,
          ttlMs: GROUP_CONTEXT_TTL_MS,
        });
        if (sharedEntries.length > 0) {
          const lines = sharedEntries.map((e) =>
            `- [${e.source}] ${e.text.slice(0, 300)}`
          );
          contextBlock = `\n\n之前的讨论历史：\n${lines.join("\n")}`;
        }
      } catch (err) {
        console.error(`[A2A] Failed to read shared context: ${err.message}`);
      }

      // 构建 prompt：让 AI 决定是否要接话
      const prompt = `你是 ${DEFAULT_BACKEND.toUpperCase()}。
群聊中有另一个 bot（${meta.sender}）刚回复了用户：
${meta.content.slice(0, 1500)}
${meta.originalPrompt ? `\n用户的原始问题：${meta.originalPrompt}` : ""}${contextBlock}

作为 ${DEFAULT_BACKEND.toUpperCase()}，直接回复你想说的话（可以同意、补充、纠正或提问）。如果实在没话说再回 [NO_RESPONSE]。
如果有有价值的内容要补充，直接回复你的观点。
如果没有，只回复 [NO_RESPONSE]，不要发送任何其他内容。`;

      // Claude SDK 需要显式权限配置，否则子进程会卡在 TTY 权限确认
      const a2aOverrides = DEFAULT_BACKEND === "claude" ? {
        permissionMode: "dontAsk",
        allowedTools: ["Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch"],
        persistSession: false,
        maxTurns: 1,
      } : {};

      let responseText = "";
      try {
        console.log(`[A2A] Calling ${DEFAULT_BACKEND} adapter with prompt length: ${prompt.length}`);
        for await (const event of adapter.streamQuery(prompt, null, undefined, a2aOverrides)) {
          if (event.type === "text") {
            responseText += event.text;
          }
          // Codex adapter 的回复在 result.text 里，Claude 的在 text 事件——只在没收到 text 事件时用 result
          if (event.type === "result" && event.text && !responseText) {
            responseText = event.text;
          }
        }
        console.log(`[A2A] Got response, length: ${responseText.length}`);
      } catch (err) {
        console.error(`[A2A] streamQuery error: ${err.message}`);
        console.error(`[A2A] stack: ${err.stack}`);
        return;
      }

      // 检查是否是 [NO_RESPONSE]
      if (responseText.includes("[NO_RESPONSE]")) {
        console.log(`[A2A] ${DEFAULT_BACKEND} declined to respond`);
        return;
      }

      if (responseText.trim()) {
        // 发送到 TG
        const sent = await bot.api.sendMessage(meta.chatId, responseText);

        // 写入共享上下文
        await writeSharedMessage(meta.chatId, {
          source: `bot:@${bot.botInfo?.username || DEFAULT_BACKEND}`,
          backend: DEFAULT_BACKEND,
          role: "assistant",
          text: responseText,
        });

        // 广播给其他 bot
        await a2aBus.broadcast({
          chatId: meta.chatId,
          generation: meta.generation + 1,
          content: responseText,
          originalPrompt: meta.originalPrompt || meta.content.slice(0, 500),
          telegramMessageId: sent.message_id,
        });

        console.log(`[A2A] ${DEFAULT_BACKEND} responded to ${meta.sender}`);
      }
    } catch (err) {
      console.error(`[A2A] Handler error: ${err.message}`);
    }
  });

  // 注册 relay handler：收到 relay 请求时调用本地 AI 后端处理并返回结果
  a2aBus.onRelay(async ({ sender, prompt }) => {
    console.log(`[A2A] Relay from ${sender}: "${prompt.slice(0, 80)}..."`);

    const adapter = adapters[DEFAULT_BACKEND];
    if (!adapter) throw new Error(`No adapter for ${DEFAULT_BACKEND}`);

    const relayOverrides = DEFAULT_BACKEND === "claude" ? {
      permissionMode: "dontAsk",
      allowedTools: ["Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch"],
      persistSession: false,
      maxTurns: 1,
    } : {};

    let responseText = "";
    for await (const event of adapter.streamQuery(prompt, null, undefined, relayOverrides)) {
      if (event.type === "text") responseText += event.text;
      // Codex adapter 的回复在 result.text 里，Claude 的在 text 事件里——只在没收到 text 事件时用 result
      if (event.type === "result" && event.text && !responseText) responseText = event.text;
    }

    console.log(`[A2A] Relay response ready, length: ${responseText.length}`);
    return responseText;
  });
}

// ── 初始化后端适配器 ──
const adapters = {};
for (const name of REQUESTED_BACKENDS) {
  try {
    adapters[name] = createBackend(name, { cwd: CC_CWD });
  } catch (e) {
    console.warn(`[适配器] ${name} 初始化失败: ${e.message}`);
  }
}

const ACTIVE_BACKENDS = AVAILABLE_BACKENDS.filter((name) => adapters[name]);

function getFallbackBackend() {
  return ACTIVE_BACKENDS[0] || DEFAULT_BACKEND || "claude";
}

if (!ACTIVE_BACKENDS.length) {
  console.error("FATAL: no backend is available for this instance. Check config.json or environment variables.");
  process.exit(1);
}

function resolveBackend(chatId, backendName = null) {
  const effectiveBackend = backendName && adapters[backendName]
    ? backendName
    : getFallbackBackend();
  return {
    backendName: effectiveBackend,
    adapter: adapters[effectiveBackend] || null,
  };
}

function getAdapter(chatId) {
  return resolveBackend(chatId).adapter;
}

function getBackendName(chatId) {
  return resolveBackend(chatId).backendName;
}

function getBackendStatusNote(backendName) {
  const profile = getBackendProfile(backendName);
  if (profile.maturity === "experimental") {
    return `定位: 实验兼容后端（主推荐路径仍是 Claude / Codex）\n`;
  }
  if (profile.maturity === "recommended") {
    return `定位: 主推荐后端\n`;
  }
  return "";
}

const executor = createExecutor(EXECUTOR_MODE, { resolveBackend });

if (!TOKEN || TOKEN.includes("BotFather")) {
  console.error("请在 config.json 或环境变量中填入 TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

// ── 代理 ──
const fetchOptions = PROXY
  ? { agent: new HttpsProxyAgent(PROXY) }
  : {};

// ── Bot 初始化 ──
const bot = new Bot(TOKEN, {
  client: {
    baseFetchConfig: fetchOptions,
  },
});

// ── 内存状态 ──
const groupContext = new Map(); // chatId -> [{ messageId, role, source, text, ts }]
const recentTriggered = new Map(); // `${chatId}:${messageId}` -> ts
// FlushGate: 连续消息合并 + 处理中缓冲（替代旧的 processingChats 硬锁）
const flushGate = createFlushGate({
  batchDelayMs: 800,
  maxBufferSize: 5,
  onBuffered: async (chatId, ctx) => {
    await ctx.reply("📥 已收到，会在当前任务完成后一起处理。").catch(() => {});
  },
});
const verboseSettings = new Map(); // chatId -> verboseLevel
const pendingPermissions = new Map(); // permId -> { resolve, cleanup, toolName, chatId, ... }
const chatPermState = new Map(); // chatId -> { alwaysAllowed: Set, yolo: boolean }
let permIdCounter = 0;

// A2A 追踪：当前是否在处理 A2A 消息，以及相关元数据
let currentA2AMetadata = null; // { chatId, sender, senderUsername, generation, originalPrompt, telegramMessageId } | null

function setA2AMetadata(metadata) {
  currentA2AMetadata = metadata;
}

function clearA2AMetadata() {
  currentA2AMetadata = null;
}

function getA2AMetadata() {
  return currentA2AMetadata;
}
const POLLING_CONFLICT_BASE_DELAY_MS = 5000;
const POLLING_CONFLICT_MAX_DELAY_MS = 60000;

// ── 工具函数（从旧 bridge 原样复制）──

function toTextContent(ctx) {
  return (ctx.message?.text || ctx.message?.caption || "").trim();
}

function toSource(ctx) {
  const username = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "unknown");
  const prefix = ctx.from?.is_bot ? "bot" : "user";
  return `${prefix}:${username}`;
}

function estimateTokens(text) {
  const cjkChars = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
  const wordChars = (text.match(/[A-Za-z0-9_]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  const restChars = Math.max(0, text.length - cjkChars - wordChars);
  return cjkChars + words + Math.ceil(restChars / 3);
}

function cleanupContextEntries(entries, nowTs = Date.now()) {
  const minTs = nowTs - GROUP_CONTEXT_TTL_MS;
  const active = entries.filter((e) => e.ts >= minTs);
  while (active.length > GROUP_CONTEXT_MAX_MESSAGES) active.shift();
  let totalTokens = active.reduce((sum, e) => sum + (e.tokens || estimateTokens(e.text)), 0);
  while (active.length > 0 && totalTokens > GROUP_CONTEXT_MAX_TOKENS) {
    const removed = active.shift();
    totalTokens -= (removed.tokens || estimateTokens(removed.text));
  }
  return active;
}

function isDuplicateTrigger(ctx) {
  if (!ctx.chat?.id || !ctx.message?.message_id) return false;
  const nowTs = Date.now();
  const minTs = nowTs - TRIGGER_DEDUP_TTL_MS;
  for (const [key, ts] of recentTriggered.entries()) {
    if (ts < minTs) recentTriggered.delete(key);
  }
  const key = `${ctx.chat.id}:${ctx.message.message_id}`;
  if (recentTriggered.has(key)) return true;
  recentTriggered.set(key, nowTs);
  return false;
}

function pushGroupContext(ctx) {
  if (!ENABLE_GROUP_SHARED_CONTEXT) return;
  const chat = ctx.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;
  if (!ctx.message) return;
  const text = toTextContent(ctx);
  if (!text) return;

  const chatId = chat.id;
  const messageId = ctx.message.message_id;
  const entries = cleanupContextEntries(groupContext.get(chatId) || []);
  if (entries.some((e) => e.messageId === messageId)) return;

  entries.push({
    messageId,
    role: ctx.from?.is_bot ? "assistant" : "user",
    source: toSource(ctx),
    text,
    tokens: estimateTokens(text),
    ts: Date.now(),
  });
  groupContext.set(chatId, cleanupContextEntries(entries));
}

async function buildPromptWithContext(ctx, userPrompt) {
  const chat = ctx.chat;
  if (!ENABLE_GROUP_SHARED_CONTEXT || !chat || (chat.type !== "group" && chat.type !== "supergroup")) {
    return userPrompt;
  }

  // 内存上下文（人类消息，Telegram 正常推送）
  const memEntries = cleanupContextEntries(groupContext.get(chat.id) || []);
  const currentMsgId = ctx.message?.message_id;
  const memFiltered = memEntries
    .filter((e) => e.messageId !== currentMsgId)
    .map((e) => ({ role: e.role, source: e.source, text: e.text, ts: e.ts }));

  // 共享上下文（其他 bot 的回复）
  const sharedEntries = await readSharedMessages(chat.id, {
    maxMessages: GROUP_CONTEXT_MAX_MESSAGES,
    maxTokens: GROUP_CONTEXT_MAX_TOKENS,
    ttlMs: GROUP_CONTEXT_TTL_MS,
  });

  // 合并 + 按时间排序 + 去重（相同 ts + source 视为重复）
  const seen = new Set();
  const merged = [...memFiltered, ...sharedEntries]
    .sort((a, b) => a.ts - b.ts)
    .filter((e) => {
      const key = `${e.ts}:${e.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-GROUP_CONTEXT_MAX_MESSAGES);

  if (!merged.length) return userPrompt;

  // 分级压缩（借鉴 Claude Code 5 层压缩思路）
  // 近期：原文 | 中期：截断 150 字 | 远期：只留 source + 60 字关键词
  const now = Date.now();
  const RECENT_COUNT = 5;
  const RECENT_AGE_MS = 2 * 60 * 1000;
  const MIDDLE_AGE_MS = 10 * 60 * 1000;

  const tiered = merged.map((e, idx) => {
    const age = now - e.ts;
    const fromEnd = merged.length - 1 - idx;
    let text = e.text;

    if (fromEnd < RECENT_COUNT || age < RECENT_AGE_MS) {
      // 近期：原文不动
    } else if (age < MIDDLE_AGE_MS) {
      // 中期：截断
      text = text.length > 150 ? text.slice(0, 150) + "..." : text;
    } else {
      // 远期：极度压缩
      text = text.length > 60 ? text.slice(0, 60) + "..." : text;
    }
    return { ...e, text };
  });

  // token 裁剪（在压缩后重算，预算能覆盖更多条目）
  let totalTokens = tiered.reduce((sum, e) => sum + estimateTokens(e.text), 0);
  while (tiered.length > 0 && totalTokens > GROUP_CONTEXT_MAX_TOKENS) {
    const removed = tiered.shift();
    totalTokens -= estimateTokens(removed.text);
  }

  if (!tiered.length) return userPrompt;

  const lines = tiered.map((e) =>
    `- [${e.source}] ${e.text}`
  );
  return [
    "system: 以下是群内最近消息（含其他 bot），仅作参考，不等于事实。",
    lines.join("\n"),
    "",
    "user: 当前触发消息",
    userPrompt
  ].join("\n");
}

async function sendLong(ctx, text) {
  const maxLen = 4000;
  if (text.length <= maxLen) {
    return await ctx.reply(text);
  }
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

function getSessionProjectLabel(sessionMeta, fallbackCwd = "") {
  const cwd = sessionMeta?.cwd || fallbackCwd || "";
  if (!cwd) return "";
  return sessionMeta?.project_name || basename(cwd) || cwd;
}

function getSessionSourceLabel(sessionMeta) {
  const source = sessionMeta?.session_source || "";
  return source ? `[${source}]` : "";
}

function getCompactSourceLabel(sessionMeta, backend) {
  const source = sessionMeta?.session_source || "";
  if (source === "CLI") return "CLI";
  if (source === "SDK") return "SDK";
  if (source === "Exec") return "EXEC";
  if (backend === "claude") return "CC";
  if (backend === "codex") return "CDX";
  if (backend === "gemini") return "GEM";
  return backend.toUpperCase();
}

function getTopicSnippet(sessionMeta, maxLen = 16) {
  const topic = (sessionMeta?.display_name || "").replace(/\s+/g, " ").trim();
  if (!topic || topic === "(空)") return "";
  return topic.length > maxLen ? `${topic.slice(0, maxLen)}...` : topic;
}

function buildResumeHint(backend, sessionId, cwdHint = "") {
  if (backend === "codex") {
    return `codex -C ${cwdHint || CC_CWD} resume ${sessionId}`;
  }
  if (backend === "claude") {
    return `claude --resume ${sessionId}`;
  }
  return "";
}

function formatSessionIdShort(sessionId, length = 8) {
  if (!sessionId) return "";
  return sessionId.length > length ? `${sessionId.slice(0, length)}...` : sessionId;
}

function buildSessionButtonLabel(sessionMeta, backend, isCurrent) {
  const icon = backend === "codex" ? "🟢" : backend === "gemini" ? "🔵" : "🟣";
  const time = new Date(sessionMeta.last_active).toISOString().slice(5, 16).replace("T", " ");
  const project = getSessionProjectLabel(sessionMeta);
  const source = getCompactSourceLabel(sessionMeta, backend);
  const topic = getTopicSnippet(sessionMeta);
  const parts = [icon, source, project || "(unknown)", time, topic].filter(Boolean);
  const mark = isCurrent ? " ✦" : "";
  return `${parts.join(" · ").slice(0, 55)}${mark}`;
}

function formatPreviewRole(role) {
  if (role === "assistant") return "A";
  if (role === "user") return "U";
  return "?";
}

async function sendSessionPeek(ctx, adapter, sessionId, limit = 6) {
  if (!adapter.inspectSession) {
    await ctx.reply(`${adapter.icon} 当前后端不支持会话只读预览。`);
    return false;
  }

  const sessionInfo = await adapter.inspectSession(sessionId, { limit });
  if (!sessionInfo) {
    await ctx.reply(`未找到会话: ${sessionId}`);
    return false;
  }

  const project = getSessionProjectLabel(sessionInfo);
  const source = getSessionSourceLabel(sessionInfo);
  const previewLines = (sessionInfo.preview_messages || []).map(
    (msg) => `${formatPreviewRole(msg.role)}: ${msg.text}`,
  );
  const previewText = previewLines.length
    ? previewLines.join("\n")
    : "(没有解析到可展示的消息片段)";

  await sendLong(
    ctx,
    `${adapter.icon} 只读预览 ${sessionId}\n` +
      `ID: \`${sessionId}\`\n` +
      `${project ? `项目: ${project}${source ? ` ${source}` : ""}\n` : ""}` +
      `说明: 这只会把旧会话内容展示到当前 chat，不会切换当前会话。\n\n` +
      `最近片段:\n${previewText}`,
  );
  return true;
}

function sortSessionsForDisplay(sessions, current, currentProject) {
  const activeId = current?.session_id || "";
  return [...sessions].sort((a, b) => {
    const aCurrent = a.session_id === activeId ? 1 : 0;
    const bCurrent = b.session_id === activeId ? 1 : 0;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;

    const aProject = getSessionProjectLabel(a);
    const bProject = getSessionProjectLabel(b);
    const aProjectMatch = currentProject && aProject === currentProject ? 1 : 0;
    const bProjectMatch = currentProject && bProject === currentProject ? 1 : 0;
    if (aProjectMatch !== bProjectMatch) return bProjectMatch - aProjectMatch;

    return Number(b.last_active || 0) - Number(a.last_active || 0);
  });
}

async function enrichSessionMeta(adapter, session, fallbackBackend) {
  const sessionId = session.session_id || session.sessionId;
  const backend = session.backend || fallbackBackend;
  const base = { ...session, session_id: sessionId, backend };
  if (!adapter?.resolveSession || !sessionId) {
    return base;
  }
  const resolved = await adapter.resolveSession(sessionId);
  return resolved ? { ...base, ...resolved, session_id: sessionId, backend } : base;
}

async function getOwnedSessionsForChat(chatId, backendName, adapter, limit = 10) {
  const owned = recentSessions(limit, {
    chatId,
    backend: backendName,
    ownership: "owned",
  });
  const enriched = [];
  for (const session of owned) {
    enriched.push(await enrichSessionMeta(adapter, session, backendName));
  }
  return enriched;
}

async function getExternalSessionsForChat(chatId, backendName, adapter, limit = 10) {
  if (!adapter?.listSessions) {
    return [];
  }

  const scanned = await adapter.listSessions(limit * 3);
  const external = [];

  for (const session of scanned) {
    const sessionId = session.session_id || session.sessionId;
    if (!sessionId) continue;
    if (sessionBelongsToChat(chatId, sessionId, backendName, "owned")) continue;
    external.push(await enrichSessionMeta(adapter, session, backendName));
    if (external.length >= limit) break;
  }

  return external;
}

function mergeSessionsForPicker(ownedSessions, externalSessions) {
  const merged = [...ownedSessions];
  const seen = new Set(ownedSessions.map((session) => session.session_id));

  for (const session of externalSessions) {
    if (seen.has(session.session_id)) continue;
    merged.push(session);
  }

  return merged;
}

// ── 文件下载 ──
const FILE_DIR = join(import.meta.dir, "files");
mkdirSync(FILE_DIR, { recursive: true });

async function downloadFile(ctx, fileId, filename) {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;

  const resp = PROXY
    ? await fetch(url, { agent: new HttpsProxyAgent(PROXY) })
    : await fetch(url);

  if (!resp.ok) {
    throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  const localPath = join(FILE_DIR, `${Date.now()}-${filename}`);
  writeFileSync(localPath, buffer);
  return localPath;
}

// ── 快捷回复检测 ──
function detectQuickReplies(text) {
  const tail = text.slice(-300);
  // 是非类快捷回复（不变）
  if (/要(吗|不要|么)[？?]?\s*$/.test(tail)) return ["要", "不要"];
  if (/好(吗|不好|么)[？?]?\s*$/.test(tail)) return ["好", "不好"];
  if (/是(吗|不是|么)[？?]?\s*$/.test(tail)) return ["是", "不是"];
  if (/对(吗|不对|么)[？?]?\s*$/.test(tail)) return ["对", "不对"];
  if (/可以(吗|么)[？?]?\s*$/.test(tail)) return ["可以", "不用了"];
  if (/继续(吗|么)[？?]?\s*$/.test(tail)) return ["继续", "算了"];
  if (/确认(吗|么)[？?]?\s*$/.test(tail)) return ["确认", "取消"];

  // 数字选项：从最后一个段落分隔处开始扫描，避免截断丢失前面的选项
  const breakIdx = text.lastIndexOf("\n\n");
  const optionBlock = breakIdx >= 0 && text.length - breakIdx < 600
    ? text.slice(breakIdx)
    : text.slice(-500);

  const optionRe = /(?:^|\n)\s*(\d+)[.、)）]\s*(.+)/g;
  const options = [];
  let m;
  while ((m = optionRe.exec(optionBlock)) !== null) {
    const num = m[1];
    const label = m[2].trim().split("\n")[0].slice(0, 40);
    options.push(`${num}. ${label}`);
  }
  if (options.length >= 2 && options.length <= 6) {
    return options;
  }
  return null;
}

// ── Tool Approval（工具审批）──

function getPermState(chatId) {
  if (!chatPermState.has(chatId)) {
    chatPermState.set(chatId, { alwaysAllowed: new Set(), yolo: false });
  }
  return chatPermState.get(chatId);
}

function formatToolInput(toolName, input) {
  if (toolName === "Bash" && input.command) {
    let text = input.description ? `${input.description}\n${input.command}` : input.command;
    return text.slice(0, 300);
  }
  if (["Edit", "Write", "Read"].includes(toolName) && input.file_path) {
    return input.file_path;
  }
  const json = JSON.stringify(input, null, 2);
  return json.length > 300 ? json.slice(0, 300) + "..." : json;
}

function summarizeText(text, maxLen = 120) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 3)}...` : normalized;
}

function formatTaskStatus(task) {
  const time = new Date(task.updated_at || task.created_at).toISOString().slice(5, 16).replace("T", " ");
  const tool = task.approval_tool ? ` · ${task.approval_tool}` : "";
  const summary = summarizeText(task.prompt_summary || task.result_summary || "", 36);
  const suffix = summary ? ` · ${summary}` : "";
  return `${task.task_id.slice(0, 10)} · ${task.status}${tool} · ${task.executor} · ${time}${suffix}`;
}

function createPermissionHandler(ctx, taskId) {
  const chatId = ctx.chat.id;

  return async (toolName, input, sdkOptions) => {
    const state = getPermState(chatId);

    // YOLO mode: auto-allow everything
    if (state.yolo) {
      if (taskId) markTaskApproved(taskId, toolName);
      return { behavior: "allow", toolUseID: sdkOptions.toolUseID };
    }

    // Always-allowed tool: auto-allow
    if (state.alwaysAllowed.has(toolName)) {
      if (taskId) markTaskApproved(taskId, toolName);
      return {
        behavior: "allow",
        updatedPermissions: sdkOptions.suggestions || [],
        toolUseID: sdkOptions.toolUseID,
      };
    }

    // Send inline keyboard to Telegram
    const permId = ++permIdCounter;
    const display = formatToolInput(toolName, input);
    const reason = sdkOptions.decisionReason ? `\n${sdkOptions.decisionReason}` : "";
    if (taskId) setTaskApprovalRequired(taskId, toolName);

    const text = `🔒 *Tool approval needed*\n\nTool: *${toolName}*${reason}\n\`\`\`\n${display}\n\`\`\`\n\nChoose an action:`;
    const kb = new InlineKeyboard()
      .text("Allow", `perm:${permId}:allow`)
      .text("Deny", `perm:${permId}:deny`).row()
      .text(`Always "${toolName}"`, `perm:${permId}:always`)
      .text("YOLO", `perm:${permId}:yolo`);

    await ctx.api.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: kb,
    }).catch(() => {
      ctx.api.sendMessage(chatId, text.replace(/\*/g, "").replace(/```/g, ""), { reply_markup: kb });
    });

    // Wait for user response (5 min timeout)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingPermissions.delete(permId);
        if (taskId) markTaskRejected(taskId, toolName);
        resolve({ behavior: "deny", message: "审批超时（5分钟）", toolUseID: sdkOptions.toolUseID });
      }, 5 * 60 * 1000);

      pendingPermissions.set(permId, {
        resolve,
        cleanup: () => clearTimeout(timeout),
        toolName,
        chatId,
        taskId,
        suggestions: sdkOptions.suggestions,
        toolUseID: sdkOptions.toolUseID,
      });
    });
  };
}

// ── 核心：提交 prompt 并实时流式返回结果（通过适配器）──
// processPrompt: 实际的处理逻辑（被 FlushGate 调用）
async function processPrompt(ctx, prompt) {
  const chatId = ctx.chat.id;
  const adapter = getAdapter(chatId);
  const backendName = getBackendName(chatId);
  const verboseLevel = verboseSettings.get(chatId) ?? DEFAULT_VERBOSE;
  const progress = createProgressTracker(ctx, chatId, verboseLevel, adapter.label);
  const taskId = createTask({
    chatId,
    backend: backendName,
    executor: executor.name,
    capability: "ai_turn",
    action: "stream_query",
    promptSummary: summarizeText(prompt, 120),
  });
  let taskFinalized = false;

  function finalizeSuccess(summary = "") {
    if (taskFinalized) return;
    completeTask(taskId, summary);
    taskFinalized = true;
  }

  function finalizeFailure(summary = "", errorCode = "RESULT_ERROR") {
    if (taskFinalized) return;
    failTask(taskId, summary, errorCode);
    taskFinalized = true;
  }

  try {
    markTaskStarted(taskId);
    await progress.start();

    const fullPrompt = await buildPromptWithContext(ctx, prompt);
    const session = getSession(chatId);
    // 只复用同后端的 session
    const sessionId = (session && session.backend === backendName) ? session.session_id : null;

    let capturedSessionId = sessionId || null;
    let resultText = "";
    let resultSuccess = true;

    // 软看门狗：只打日志，不 abort（TG 发出去的消息无法撤回）
    const startTime = Date.now();
    const watchdogHandle = setTimeout(() => {
      console.warn(`[watchdog] chatId=${chatId} 已运行 ${Math.round(WATCHDOG_WARN_MS / 60000)} 分钟，仍在处理`);
    }, WATCHDOG_WARN_MS);

    const modelOverride = getChatModel(chatId);
    const streamOverrides = modelOverride ? { model: modelOverride } : {};

    // Tool approval: only for Claude backend
    if (backendName === "claude") {
      streamOverrides.requestPermission = createPermissionHandler(ctx, taskId);
    }

    try {
      for await (const event of executor.streamTask({
        chatId,
        backendName,
        prompt: fullPrompt,
        sessionId,
      }, undefined, streamOverrides)) {
        if (event.type === "session_init") {
          capturedSessionId = event.sessionId;
        }

        // AskUserQuestion: 发送完整问题 + inline 按钮
        if (event.type === "question") {
          const header = event.header ? `*${event.header}*\n\n` : "";
          let text = `${header}❓ ${event.question}\n`;
          const kb = new InlineKeyboard();
          for (let i = 0; i < event.options.length; i++) {
            const opt = event.options[i];
            text += `\n${i + 1}. *${opt.label}*`;
            if (opt.description) text += `\n   ${opt.description}`;
            // callback data 限 64 字节，用 ask:序号:简短标签
            kb.text(`${i + 1}. ${opt.label}`, `ask:${i}:${opt.label.slice(0, 40)}`).row();
          }
          await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb }).catch(() => {
            // Markdown 失败时 fallback 纯文本
            ctx.reply(text.replace(/\*/g, ""), { reply_markup: kb }).catch(() => {});
          });
        }

        // 实时进度（progress + text 事件）
        progress.processEvent(event);

        // 捕获最终结果
        if (event.type === "result") {
          resultSuccess = event.success;
          resultText = event.text || "";
          const costStr = event.cost != null ? ` 花费 $${event.cost.toFixed(4)}` : "";
          const durStr = event.duration != null ? ` 耗时 ${event.duration}ms` : "";
          console.log(`[${adapter.label}] 结果: ${resultSuccess ? "success" : "error"}${durStr}${costStr}`);
        }
      }
    } catch (err) {
      resultText = `SDK 错误: ${err.message}`;
      resultSuccess = false;
      console.error(`[${adapter.label}] SDK 异常: ${err.message}\n${err.stack}`);
      finalizeFailure(summarizeText(resultText, 240), "EXECUTOR_ERROR");
    } finally {
      clearTimeout(watchdogHandle);
    }

    // 存 session
    if (capturedSessionId) {
      const displayName = prompt.slice(0, 30);
      setSession(chatId, capturedSessionId, displayName, backendName, "owned");
    }

    // 进度消息 → 摘要（verbose >= 1 时保留，否则删除）
    await progress.finish({
      keepAsSummary: verboseLevel >= 1 && resultSuccess,
      durationMs: Date.now() - startTime,
    });

    // 发最终结果
    if (!resultSuccess) {
      finalizeFailure(summarizeText(resultText, 240), "RESULT_ERROR");
      await sendLong(ctx, `${adapter.label} 错误: ${resultText}`);
    } else if (resultText) {
      finalizeSuccess(summarizeText(resultText, 240));
      const replies = detectQuickReplies(resultText);
      if (replies && resultText.length <= 4000) {
        const kb = new InlineKeyboard();
        for (const r of replies) {
          // TG callback_data 限 64 字节，"reply:" 占 6 字节，剩 58 给内容
          const cbData = `reply:${r.slice(0, 58)}`;
          kb.text(r, cbData);
        }
        await ctx.reply(resultText, { reply_markup: kb });
      } else {
        await sendLong(ctx, resultText);
      }
    } else {
      finalizeSuccess("");
      await ctx.reply(`${adapter.label} 无输出。`);
    }

    // 写入共享上下文 + A2A 广播（仅群聊——私聊不需要跨 bot 共享，避免 DM 串台）
    const isGroupChat = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    if (resultText && resultSuccess && isGroupChat) {
      await writeSharedMessage(chatId, {
        source: `bot:@${bot.botInfo?.username || backendName}`,
        backend: backendName,
        role: "assistant",
        text: resultText,
      });

      // A2A 广播
      if (a2aBus && isGroupChat) {
        const a2aMeta = getA2AMetadata();
        const generation = a2aMeta ? a2aMeta.generation + 1 : 0;
        const originalPrompt = a2aMeta?.originalPrompt || (prompt ? prompt.slice(0, 500) : "");

        a2aBus.broadcast({
          chatId,
          generation,
          content: resultText,
          originalPrompt,
          telegramMessageId: ctx.message?.message_id,
        }).catch((err) => console.error("[A2A] broadcast error:", err.message));
      }
    }

    // 新会话首条：显示 session ID（只在新建时发一次）
    if (capturedSessionId && capturedSessionId !== sessionId) {
      const sid = capturedSessionId;
      const sessionMeta = adapter.resolveSession ? await adapter.resolveSession(sid) : null;
      const effectiveCwd = sessionMeta?.cwd || CC_CWD;
      const project = getSessionProjectLabel(sessionMeta, effectiveCwd);
      const source = getSessionSourceLabel(sessionMeta);
      const resumeCmd = buildResumeHint(backendName, sid, effectiveCwd);
      const resumeLine = resumeCmd ? `\n终端接续: \`${resumeCmd}\`` : "";
      await ctx.reply(
        `${adapter.icon} 新会话 \`${sid}\`` +
        `${project ? `\n项目: ${project}${source ? ` ${source}` : ""}` : ""}` +
        `${resumeLine}`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    }
  } catch (e) {
    finalizeFailure(summarizeText(e.message, 240), "BRIDGE_ERROR");
    await progress.finish();
    await ctx.reply(`桥接错误: ${e.message}`);
  }
}

// submitAndWait: 外层入口，通过 FlushGate 合并连续消息
async function submitAndWait(ctx, prompt) {
  const chatId = ctx.chat.id;
  await flushGate.enqueue(chatId, { ctx, prompt }, processPrompt);
}

// ── 权限 + 群聊过滤中间件 ──
bot.use((ctx, next) => {
  // 群聊消息先入上下文
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    pushGroupContext(ctx);
  }
  // 仅主人可触发
  if (ctx.from?.id !== OWNER_ID) return;
  // 群聊中：只响应 @提及、/命令、回复 bot 的消息、回调按钮
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    if (ctx.callbackQuery) return next();
    const text = toTextContent(ctx);
    const botUsername = bot.botInfo?.username;
    const isCommand = text.startsWith("/");
    const isMention = botUsername && text.includes(`@${botUsername}`);
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === bot.botInfo?.id;
    if (!isCommand && !isMention && !isReplyToBot) return;
  }
  if (isDuplicateTrigger(ctx)) return;
  return next();
});

// ── /new 命令：重置会话 ──
bot.command("new", async (ctx) => {
  deleteSession(ctx.chat.id);
  chatPermState.delete(ctx.chat.id);
  const adapter = getAdapter(ctx.chat.id);
  await ctx.reply(`会话已重置，下条消息将开启新 ${adapter.label} 会话。`);
});

// ── /resume 命令：显式绑定已有 session id（适合终端/TG 手动接续） ──
bot.command("resume", async (ctx) => {
  const sessionId = ctx.match?.trim();
  if (!sessionId) {
    const backendName = getBackendName(ctx.chat.id);
    await ctx.reply(`用法: /resume <session-id>\n当前后端: ${backendName}\n也可以先用 /sessions 直接点选。`);
    return;
  }

  const backend = getBackendName(ctx.chat.id);
  const adapter = getAdapter(ctx.chat.id);
  const adapterInfo = adapter.statusInfo(getChatModel(ctx.chat.id));
  const sessionMeta = adapter.resolveSession ? await adapter.resolveSession(sessionId) : null;
  const project = getSessionProjectLabel(sessionMeta, adapterInfo.cwd);
  const source = getSessionSourceLabel(sessionMeta);

  if (!sessionBelongsToChat(ctx.chat.id, sessionId, backend, "owned")) {
    const resumeCmd = buildResumeHint(backend, sessionId, sessionMeta?.cwd || adapterInfo.cwd);
    await ctx.reply(
      `${adapter.icon} 已拒绝绑定外部会话 \`${sessionId}\`（${backend}）\n` +
      `${project ? `项目: ${project}${source ? ` ${source}` : ""}\n` : ""}` +
      `当前 TG 实例默认只允许恢复本 chat 自己创建的会话。` +
      `${resumeCmd ? `\n终端如需单独查看，可用: \`${resumeCmd}\`` : ""}`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  setSession(
    ctx.chat.id,
    sessionId,
    sessionMeta?.display_name || "",
    backend,
    "owned",
  );
  await ctx.reply(
    `${adapter.icon} 已绑定会话 \`${sessionId}\`（${backend}）\n` +
    `${project ? `项目: ${project}${source ? ` ${source}` : ""}\n` : ""}` +
    `后续消息会继续这个 session。`,
    { parse_mode: "Markdown" }
  );
});

// ── /peek 命令：只读查看指定 session 内容，不切换当前会话 ──
bot.command("peek", async (ctx) => {
  const sessionId = ctx.match?.trim();
  if (!sessionId) {
    await ctx.reply("用法: /peek <session-id>\n只读查看该会话的最近片段，不会切换当前会话。");
    return;
  }

  const adapter = getAdapter(ctx.chat.id);
  await sendSessionPeek(ctx, adapter, sessionId, 6);
});

// ── /sessions 命令：统一列出最近会话；点按钮只回显 ID + 片段，不切换当前会话 ──
bot.command("sessions", async (ctx) => {
  try {
    const adapter = getAdapter(ctx.chat.id);
    const backendName = getBackendName(ctx.chat.id);
    const adapterInfo = adapter.statusInfo(getChatModel(ctx.chat.id));
    const ownedSessions = await getOwnedSessionsForChat(
      ctx.chat.id,
      backendName,
      adapter,
      10,
    );
    const externalSessions = await getExternalSessionsForChat(
      ctx.chat.id,
      backendName,
      adapter,
      10,
    );
    const allSessions = mergeSessionsForPicker(ownedSessions, externalSessions);
    const current = getSession(ctx.chat.id);
    const currentProject = adapterInfo.cwd ? basename(adapterInfo.cwd) : "";
    const sortedSessions = sortSessionsForDisplay(allSessions, current, currentProject);

    if (!sortedSessions.length) {
      await ctx.reply("没有找到历史会话。");
      return;
    }

    const kb = new InlineKeyboard();
    for (const s of sortedSessions) {
      const backend = s.backend || backendName;
      const isCurrent = current && current.session_id === s.session_id;
      kb.text(buildSessionButtonLabel(s, backend, isCurrent), `peek:${s.session_id}:${backend}`).row();
    }
    kb.text("🆕 开新会话", "action:new").row();
    await ctx.reply(
      "选择会话：点一下会把该会话的完整 ID 和最近片段回显到当前聊天，不会切换当前会话。",
      { reply_markup: kb },
    );
  } catch (e) {
    await ctx.reply(`查询失败: ${e.message}`);
  }
});

// ── 按钮回调：只读查看外部会话 ──
bot.callbackQuery(/^peek:/, async (ctx) => {
  const data = ctx.callbackQuery.data.replace("peek:", "");
  const lastColon = data.lastIndexOf(":");
  let sessionId, backend;
  if (lastColon > 0 && AVAILABLE_BACKENDS.includes(data.slice(lastColon + 1))) {
    sessionId = data.slice(0, lastColon);
    backend = data.slice(lastColon + 1);
  } else {
    sessionId = data;
    backend = getBackendName(ctx.chat.id);
  }

  const adapter = adapters[backend];
  if (!adapter) {
    await ctx.answerCallbackQuery({ text: "后端不可用" });
    return;
  }

  await ctx.answerCallbackQuery({ text: `ID: ${formatSessionIdShort(sessionId, 12)}` });
  await sendSessionPeek(ctx, adapter, sessionId, 6);
});

// ── /status 命令：显示状态 ──
bot.command("status", async (ctx) => {
  const adapter = getAdapter(ctx.chat.id);
  const backendName = getBackendName(ctx.chat.id);
  const session = getSession(ctx.chat.id);
  const verbose = verboseSettings.get(ctx.chat.id) ?? DEFAULT_VERBOSE;
  const modelOverride = getChatModel(ctx.chat.id);
  const info = adapter.statusInfo(modelOverride);
  const activeTask = getActiveTask(ctx.chat.id);

  let sessionLine = "当前会话: 无（下条消息开新会话）";
  let resumeHint = "";
  let sessionMetaLine = "";
  if (session) {
    const sid = session.session_id;
    const sessionMeta = adapter.resolveSession ? await adapter.resolveSession(sid) : null;
    const effectiveCwd = sessionMeta?.cwd || info.cwd;
    const project = getSessionProjectLabel(sessionMeta, effectiveCwd);
    const source = getSessionSourceLabel(sessionMeta);
    sessionLine = `当前会话: \`${sid.slice(0, 8)}...\``;
    if (project || source || sessionMeta?.cwd) {
      sessionMetaLine =
        `\n会话项目: ${project || "(unknown)"}${source ? ` ${source}` : ""}` +
        `${sessionMeta?.cwd ? `\n会话目录: ${sessionMeta.cwd}` : ""}`;
    }
    const resumeCmd = buildResumeHint(session.backend, sid, effectiveCwd);
    if (resumeCmd) resumeHint = `\n终端接续: \`${resumeCmd}\``;
  }

  await ctx.reply(
    `${adapter.icon} 实例后端: ${adapter.label} (${backendName})\n` +
    `${getBackendStatusNote(backendName)}` +
    `执行器: ${executor.label} (${executor.name})\n` +
    `模式: ${info.mode}\n` +
    `模型: ${info.model}\n` +
    `工作目录: ${info.cwd}\n` +
    `${sessionLine}${sessionMetaLine}${resumeHint}\n` +
    `进度详细度: ${verbose}（0=关/1=工具名/2=详细）` +
    `${activeTask ? `\n活动任务: ${formatTaskStatus(activeTask)}` : ""}`,
    { parse_mode: "Markdown" }
  );
});

// A2A 命令
bot.command("a2a", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1) || [];
  const subcmd = args[0] || "status";

  if (subcmd === "status") {
    if (!a2aBus) {
      await ctx.reply("A2A 未启用。请在 config.json 中设置 shared.a2aEnabled = true 并重启。");
      return;
    }
    const stats = a2aBus.getStats();
    const lg = stats.loopGuard;
    const ph = stats.peerHealth;

    await ctx.reply(
      `🤖 A2A 状态\n` +
      `━━━━━━━━━━━━\n` +
      `本体: ${stats.self}\n` +
      `端口: ${stats.port}\n` +
      `Peers: ${stats.peers.join(", ") || "无"}\n` +
      `━━━━━━━━━━━━\n` +
      `Loop Guard:\n` +
      `  收到: ${lg.received}\n` +
      `  放行: ${lg.allowed}\n` +
      `  拦截(Generation): ${lg.blockedGeneration}\n` +
      `  拦截(Cooldown): ${lg.blockedCooldown}\n` +
      `  拦截(Rate): ${lg.blockedRate}\n` +
      `  拦截(Dup): ${lg.blockedDuplicate}\n` +
      `━━━━━━━━━━━━\n` +
      `Peer 熔断:\n` +
      Object.entries(ph).map(([name, s]) => `  ${name}: ${s.circuit} (${s.consecutiveFailures} 次失败)`).join("\n") || "  无",
      { parse_mode: "Markdown" }
    );
  } else if (subcmd === "test") {
    if (!a2aBus) {
      await ctx.reply("A2A 未启用");
      return;
    }
    await ctx.reply("正在发送测试消息...");
    const results = await a2aBus.broadcast({
      chatId: ctx.chat.id,
      generation: 0,
      content: "A2A 测试消息",
      originalPrompt: "测试",
    });
    await ctx.reply(`测试结果: 发送 ${results.sent}, 失败 ${results.failed}, 跳过 ${results.skipped}`);
  } else {
    await ctx.reply(`可用子命令: /a2a status, /a2a test`);
  }
});

// /relay <target> <message> — 主动转发消息给指定 bot（DM 和群聊均可）
bot.command("relay", async (ctx) => {
  if (!a2aBus) {
    await ctx.reply("A2A 未启用。请在 config.json 中设置 shared.a2aEnabled = true 并重启。");
    return;
  }

  const raw = ctx.match?.trim() || "";
  const spaceIdx = raw.indexOf(" ");
  const rawTarget = spaceIdx > 0 ? raw.slice(0, spaceIdx).toLowerCase() : raw.toLowerCase();
  let message = spaceIdx > 0 ? raw.slice(spaceIdx + 1).trim() : "";
  const peers = a2aBus.getPeerNames();

  // 简写映射：cc→claude, cx→codex, gm→gemini
  const ALIASES = { cc: "claude", cx: "codex", gm: "gemini" };
  const targetName = ALIASES[rawTarget] || rawTarget;

  // 回复转发：长按某条消息回复 /relay cx [可选追加指令]
  // 自动把被回复的消息内容拼进 prompt
  const replyText = ctx.message?.reply_to_message?.text || ctx.message?.reply_to_message?.caption || "";
  if (replyText) {
    const instruction = message || "请审阅以上内容";
    message = `以下是另一个 AI (${DEFAULT_BACKEND}) 的回复：\n\n${replyText}\n\n${instruction}`;
  }

  if (!targetName || !message) {
    await ctx.reply(
      `用法: /relay <target> <message>\n` +
      `回复转发: 长按消息回复 /relay <target> [追加指令]\n\n` +
      `可用目标: ${peers.join(", ") || "无"}\n` +
      `简写: cc=claude, cx=codex, gm=gemini\n` +
      `示例: /relay cx 你好，介绍一下自己\n` +
      `示例: (回复CC的消息) /relay cx 你觉得他说得对吗`
    );
    return;
  }

  if (targetName === DEFAULT_BACKEND) {
    await ctx.reply("不能转发给自己，直接发消息即可。");
    return;
  }

  if (!peers.includes(targetName)) {
    await ctx.reply(`未知目标: ${targetName}\n可用: ${peers.join(", ")}`);
    return;
  }

  const thinkingMsg = await ctx.reply(`正在转发给 ${targetName.toUpperCase()}，等待回复...`);

  try {
    const result = await a2aBus.relay(targetName, {
      prompt: message,
      sender: DEFAULT_BACKEND,
    }, RELAY_TIMEOUT_MS);

    // 删除 thinking 消息
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});

    if (result.success) {
      const response = result.response?.trim();
      if (response) {
        await sendLong(ctx, `[${targetName.toUpperCase()}] ${response}`);
      } else {
        await ctx.reply(`[${targetName.toUpperCase()}] (无输出)`);
      }
    } else {
      await ctx.reply(`转发失败: ${result.error}`);
    }
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    await ctx.reply(`转发异常: ${err.message}`);
  }
});

bot.command("tasks", async (ctx) => {
  const tasks = recentTasks(ctx.chat.id, 8);
  if (!tasks.length) {
    await ctx.reply("最近没有任务记录。");
    return;
  }

  await sendLong(
    ctx,
    [
      "最近任务：",
      ...tasks.map((task) => `- ${formatTaskStatus(task)}`),
    ].join("\n"),
  );
});

// ── /verbose 命令：设置进度详细度 ──
bot.command("verbose", async (ctx) => {
  const arg = ctx.match?.trim();
  const level = Number(arg);
  if (arg === "" || isNaN(level) || level < 0 || level > 2) {
    const current = verboseSettings.get(ctx.chat.id) ?? DEFAULT_VERBOSE;
    await ctx.reply(
      `当前进度详细度: ${current}\n` +
      `用法: /verbose 0|1|2\n` +
      `  0 = 只显示"正在处理..."\n` +
      `  1 = 显示工具名+图标\n` +
      `  2 = 工具名+输入+推理片段`
    );
    return;
  }
  verboseSettings.set(ctx.chat.id, level);
  await ctx.reply(`进度详细度已设为 ${level}`);
});

// ── /model 命令：切换当前实例的模型 ──
bot.command("model", async (ctx) => {
  const adapter = getAdapter(ctx.chat.id);
  const models = adapter.availableModels ? adapter.availableModels() : [];
  const currentModel = getChatModel(ctx.chat.id);
  const arg = ctx.match?.trim();

  if (!arg) {
    // 无参数：显示 inline 按钮选择
    if (!models.length) {
      await ctx.reply(`${adapter.icon} ${adapter.label} 不支持模型切换。`);
      return;
    }
    const kb = new InlineKeyboard();
    for (const m of models) {
      const isCurrent = (m.id === "__default__" && !currentModel) || (m.id === currentModel);
      const mark = isCurrent ? " ✦" : "";
      kb.text(`${m.label}${mark}`, `model:${m.id}`).row();
    }
    const displayModel = currentModel || models[0]?.label || "(default)";
    await ctx.reply(`${adapter.icon} 当前模型: ${displayModel}\n选择模型：`, { reply_markup: kb });
    return;
  }

  // 有参数：直接设置
  if (arg === "default" || arg === "__default__") {
    deleteChatModel(ctx.chat.id);
    await ctx.reply(`${adapter.icon} 已恢复默认模型。`);
    return;
  }
  const found = models.find(m => m.id === arg || m.label === arg);
  if (!found && models.length) {
    const list = models.map(m => `  ${m.id} — ${m.label}`).join("\n");
    await ctx.reply(`未知模型: ${arg}\n\n可用模型:\n${list}`);
    return;
  }
  setChatModel(ctx.chat.id, arg);
  await ctx.reply(`${adapter.icon} 模型已切换为: ${arg}`);
});

// ── 按钮回调：模型选择 ──
bot.callbackQuery(/^model:/, async (ctx) => {
  const modelId = ctx.callbackQuery.data.replace("model:", "");
  const adapter = getAdapter(ctx.chat.id);
  if (modelId === "__default__") {
    deleteChatModel(ctx.chat.id);
    await ctx.answerCallbackQuery({ text: "已恢复默认 ✓" });
    await ctx.editMessageText(`${adapter.icon} 已恢复默认模型。`);
  } else {
    setChatModel(ctx.chat.id, modelId);
    await ctx.answerCallbackQuery({ text: `已切换 ✓` });
    await ctx.editMessageText(`${adapter.icon} 模型已切换为: ${modelId}`);
  }
});

// ── 按钮回调：恢复会话 ──
bot.callbackQuery(/^resume:/, async (ctx) => {
  const data = ctx.callbackQuery.data.replace("resume:", "");
  // 格式: sessionId:backend
  const lastColon = data.lastIndexOf(":");
  let sessionId, backend;
  if (lastColon > 0 && AVAILABLE_BACKENDS.includes(data.slice(lastColon + 1))) {
    sessionId = data.slice(0, lastColon);
    backend = data.slice(lastColon + 1);
  } else {
    sessionId = data;
    backend = "claude";
  }

  if (!sessionBelongsToChat(ctx.chat.id, sessionId, backend, "owned")) {
    await ctx.answerCallbackQuery({ text: "外部会话已禁用" });
    await ctx.editMessageText(
      `这个会话不属于当前 TG chat，已禁止直接恢复。\n如需查看，请在终端单独接续。`,
    ).catch(() => {});
    return;
  }

  const adapter = adapters[backend];
  const icon = adapter?.icon || "🟣";
  const adapterInfo = adapter ? adapter.statusInfo(getChatModel(ctx.chat.id)) : { cwd: CC_CWD };
  const sessionMeta = adapter?.resolveSession ? await adapter.resolveSession(sessionId) : null;
  setSession(
    ctx.chat.id,
    sessionId,
    sessionMeta?.display_name || "",
    backend,
    "owned",
  );
  const project = getSessionProjectLabel(sessionMeta, adapterInfo.cwd);
  const source = getSessionSourceLabel(sessionMeta);
  await ctx.answerCallbackQuery({ text: "已恢复 ✓" });
  await ctx.editMessageText(
    `${icon} 已恢复会话 \`${sessionId.slice(0, 8)}\`（${backend}）\n` +
    `${project ? `项目: ${project}${source ? ` ${source}` : ""}\n` : ""}` +
    `继续发消息即可。`,
    { parse_mode: "Markdown" }
  );
});

// ── 按钮回调：新会话 ──
bot.callbackQuery("action:new", async (ctx) => {
  deleteSession(ctx.chat.id);
  await ctx.answerCallbackQuery({ text: "已重置 ✓" });
  const adapter = getAdapter(ctx.chat.id);
  await ctx.editMessageText(`会话已重置，下条消息将开启新 ${adapter.label} 会话。`);
});

// ── 按钮回调：AskUserQuestion 选项 ──
bot.callbackQuery(/^ask:/, async (ctx) => {
  const raw = ctx.callbackQuery.data.replace("ask:", "");
  const label = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  await ctx.answerCallbackQuery({ text: `选择: ${label}` });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await submitAndWait(ctx, label);
});

// ── 按钮回调：快捷回复 ──
bot.callbackQuery(/^reply:/, async (ctx) => {
  const text = ctx.callbackQuery.data.replace("reply:", "");
  await ctx.answerCallbackQuery({ text: `发送: ${text}` });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await submitAndWait(ctx, text);
});

// ── 按钮回调：Tool Approval ──
bot.callbackQuery(/^perm:/, async (ctx) => {
  const parts = ctx.callbackQuery.data.split(":");
  const permId = Number(parts[1]);
  const action = parts[2];
  const pending = pendingPermissions.get(permId);

  if (!pending) {
    await ctx.answerCallbackQuery({ text: "已过期" });
    return;
  }

  pendingPermissions.delete(permId);
  pending.cleanup();

  const state = getPermState(pending.chatId);

  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  if (action === "allow") {
    if (pending.taskId) markTaskApproved(pending.taskId, pending.toolName);
    await ctx.answerCallbackQuery({ text: "Allowed" });
    pending.resolve({ behavior: "allow", toolUseID: pending.toolUseID });
  } else if (action === "deny") {
    if (pending.taskId) markTaskRejected(pending.taskId, pending.toolName);
    await ctx.answerCallbackQuery({ text: "Denied" });
    pending.resolve({ behavior: "deny", message: "用户拒绝", toolUseID: pending.toolUseID });
  } else if (action === "always") {
    state.alwaysAllowed.add(pending.toolName);
    if (pending.taskId) markTaskApproved(pending.taskId, pending.toolName);
    await ctx.answerCallbackQuery({ text: `Always "${pending.toolName}"` });
    pending.resolve({
      behavior: "allow",
      updatedPermissions: pending.suggestions || [],
      toolUseID: pending.toolUseID,
    });
  } else if (action === "yolo") {
    state.yolo = true;
    if (pending.taskId) markTaskApproved(pending.taskId, pending.toolName);
    await ctx.answerCallbackQuery({ text: "YOLO mode ON" });
    pending.resolve({ behavior: "allow", toolUseID: pending.toolUseID });
  }
});

// ── 处理图片 ──
bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo;
  const largest = photo[photo.length - 1];
  const caption = ctx.message.caption || "请看这张图片";

  try {
    const localPath = await downloadFile(ctx, largest.file_id, "photo.jpg");
    await submitAndWait(ctx, `${caption}\n\n[图片文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`图片下载失败: ${e.message}`);
  }
});

// ── 处理文档 ──
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const caption = ctx.message.caption || `请处理这个文件: ${doc.file_name}`;

  if (doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply("文件太大（超过 20MB），Telegram Bot API 限制。");
    return;
  }

  try {
    const localPath = await downloadFile(ctx, doc.file_id, doc.file_name || "file");
    await submitAndWait(ctx, `${caption}\n\n[文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`文件下载失败: ${e.message}`);
  }
});

// ── 处理语音 ──
bot.on("message:voice", async (ctx) => {
  try {
    const localPath = await downloadFile(ctx, ctx.message.voice.file_id, "voice.ogg");
    await submitAndWait(ctx, `请听这段语音并回复\n\n[语音文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`语音下载失败: ${e.message}`);
  }
});

// ── 处理视频 ──
bot.on("message:video", async (ctx) => {
  await ctx.reply("暂不支持视频处理，可以截图发图片。");
});

// ── 处理文字消息 ──
bot.on("message:text", async (ctx) => {
  let text = ctx.message.text;
  const botUsername = bot.botInfo?.username;
  if (botUsername) text = text.replace(new RegExp(`@${botUsername}\\s*`, "g"), "").trim();
  if (!text) return;
  await submitAndWait(ctx, text);
});

// ── 自动清理下载文件（24h）──
function cleanOldFiles() {
  const maxAge = 24 * 60 * 60 * 1000;
  try {
    for (const f of readdirSync(FILE_DIR)) {
      const p = join(FILE_DIR, f);
      if (Date.now() - statSync(p).mtimeMs > maxAge) {
        unlinkSync(p);
        console.log(`[清理] ${f}`);
      }
    }
  } catch {}
}
setInterval(cleanOldFiles, 60 * 60 * 1000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPollingConflictError(error) {
  return error instanceof GrammyError
    && error.method === "getUpdates"
    && error.error_code === 409;
}

async function startBotPolling() {
  let conflictCount = 0;

  while (true) {
    try {
      await bot.start({
        onStart: () => console.log(`已连接，仅接受用户 ${OWNER_ID} 的消息`),
      });
      return;
    } catch (error) {
      try {
        bot.stop();
      } catch {
        // ignore stop failures during restart attempts
      }

      if (!isPollingConflictError(error)) {
        throw error;
      }

      conflictCount += 1;
      const delayMs = Math.min(
        POLLING_CONFLICT_BASE_DELAY_MS * (2 ** Math.min(conflictCount - 1, 4)),
        POLLING_CONFLICT_MAX_DELAY_MS,
      );

      console.error(
        `[Telegram] getUpdates 冲突：同一个 bot token 正被其他实例轮询。attempt=${conflictCount} retry_in=${Math.ceil(delayMs / 1000)}s`,
      );
      console.error("[Telegram] 请排查重复实例；如果确认没有其他实例，去 @BotFather 重置 token。");
      await sleep(delayMs);
    }
  }
}

// ── 启动 ──
console.log("Telegram-AI-Bridge 启动中...");
console.log(`  实例后端: ${getFallbackBackend()}`);
console.log(`  工作目录: ${CC_CWD}`);
console.log(`  进度详细度: ${DEFAULT_VERBOSE}`);
await startBotPolling();
