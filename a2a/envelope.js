// A2A Envelope — 消息封装 + 验证
// 移植自 openclaw-a2a-gateway/src/internal/envelope.ts（简化版）

import crypto from "node:crypto";

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
    protocol_version: "a2a/v1",
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

  // 协议版本
  if (envelope.protocol_version !== "a2a/v1") {
    return { code: "INVALID_VERSION", message: `Unsupported protocol: ${envelope.protocol_version}` };
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
