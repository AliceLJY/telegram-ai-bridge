// A2A Envelope — 消息封装 + 验证
// 移植自 openclaw-a2a-gateway/src/internal/envelope.ts（简化版）

import crypto from "node:crypto";

/**
 * 协议版本标签。
 * - CURRENT_PROTOCOL_VERSION：出站消息使用的当前 tag。
 * - ACCEPTED_PROTOCOL_VERSIONS：入站 validateEnvelope 接受的 tag 集合。
 *
 * v1.1 把线上 tag 从 "a2a/v1" bump 到 "a2a-tg/v1"，让协议身份自证，
 * 跟官方 A2A 视觉上不再混淆。过渡期（至少保留两个次版本号的兼容窗口）
 * 内继续接受旧 tag，并在命中旧 tag 时打一次 deprecation 日志，以免所有
 * 在跑的 bot 实例升级前互相拒收。语义/字段均无变化，仅字符串替换。
 */
export const CURRENT_PROTOCOL_VERSION = "a2a-tg/v1";
export const LEGACY_PROTOCOL_VERSIONS = ["a2a/v1"];
export const ACCEPTED_PROTOCOL_VERSIONS = [
  CURRENT_PROTOCOL_VERSION,
  ...LEGACY_PROTOCOL_VERSIONS,
];

// 已打过 deprecation 日志的旧 tag 集合，避免同一 tag 刷屏。
const warnedLegacyVersions = new Set();

/** 生成时间有序唯一 ID: {timestamp_hex}-{random12} */
export function generateId() {
  const timestampHex = Date.now().toString(16);
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `${timestampHex}-${uuid.slice(-12)}`;
}

/**
 * 创建 A2A envelope
 * @param {object} opts
 * @param {string} opts.sender - 发送方 bot 名称 (claude/codex/gemini)
 * @param {string} opts.senderUsername - TG bot username
 * @param {number} opts.chatId - TG 群聊 ID
 * @param {number} opts.generation - 代际计数（用户触发=0, bot回复=1, bot对bot=2）
 * @param {string} opts.content - 完整回复内容
 * @param {string} [opts.originalPrompt] - 触发回复的原始提问（截断）
 * @param {number} [opts.telegramMessageId] - TG 消息 ID
 * @param {number} [opts.ttlSeconds] - 过期时间（默认 300s）
 * @param {string} [opts.correlationId] - 关联 ID
 */
export function createEnvelope(opts) {
  return {
    protocol_version: CURRENT_PROTOCOL_VERSION,
    message_id: generateId(),
    idempotency_key: generateId(),
    correlation_id: opts.correlationId || null,
    timestamp: new Date().toISOString(),
    ttl_seconds: opts.ttlSeconds ?? 300,
    sender: opts.sender,
    sender_username: opts.senderUsername || "",
    chat_id: opts.chatId,
    generation: opts.generation ?? 0,
    content: opts.content,
    original_prompt: opts.originalPrompt || "",
    telegram_message_id: opts.telegramMessageId || null,
  };
}

/**
 * 验证 envelope，返回 null（通过）或 { code, message }（失败）
 */
export function validateEnvelope(envelope, config = {}) {
  const maxGeneration = config.maxGeneration ?? 2;
  const maxPayloadBytes = config.maxPayloadBytes ?? 2 * 1024 * 1024;

  // 协议版本：接受当前 tag + 过渡期内的旧 tag。命中旧 tag 时每个 tag 打一次 deprecation 日志。
  if (!ACCEPTED_PROTOCOL_VERSIONS.includes(envelope.protocol_version)) {
    return { code: "INVALID_VERSION", message: `Unsupported protocol: ${envelope.protocol_version}` };
  }
  if (
    LEGACY_PROTOCOL_VERSIONS.includes(envelope.protocol_version) &&
    !warnedLegacyVersions.has(envelope.protocol_version)
  ) {
    warnedLegacyVersions.add(envelope.protocol_version);
    console.warn(
      `[a2a] deprecation: protocol_version "${envelope.protocol_version}" is legacy, migrate to "${CURRENT_PROTOCOL_VERSION}"`,
    );
  }

  // 必填字段
  for (const field of ["message_id", "idempotency_key", "timestamp", "sender", "chat_id", "content"]) {
    if (envelope[field] === undefined || envelope[field] === null || envelope[field] === "") {
      return { code: "MISSING_FIELD", message: `Missing required field: ${field}` };
    }
  }

  // TTL 过期
  const envelopeTime = Date.parse(envelope.timestamp);
  if (isNaN(envelopeTime)) {
    return { code: "MISSING_FIELD", message: "Invalid timestamp format" };
  }
  if (envelopeTime + (envelope.ttl_seconds || 300) * 1000 <= Date.now()) {
    return { code: "EXPIRED", message: "Envelope TTL has expired" };
  }

  // Generation 上限（硬编码防死循环）
  if (typeof envelope.generation !== "number" || envelope.generation >= maxGeneration) {
    return { code: "GENERATION_LIMIT", message: `Generation ${envelope.generation} >= limit ${maxGeneration}` };
  }

  // Payload 大小
  const payloadSize = Buffer.byteLength(JSON.stringify(envelope.content), "utf8");
  if (payloadSize > maxPayloadBytes) {
    return { code: "PAYLOAD_TOO_LARGE", message: `Payload ${payloadSize} > limit ${maxPayloadBytes}` };
  }

  return null;
}
