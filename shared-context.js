// 跨 bot 进程共享的群聊上下文（SQLite WAL 模式，支持并发读写）
// 解决 Telegram 平台限制：bot 之间互相收不到消息
import { Database } from "bun:sqlite";
import { join, isAbsolute } from "path";

let db = null;

/**
 * 初始化共享上下文数据库
 * @param {string} [dbPath] - 数据库文件路径，默认 shared-context.db
 */
export function initSharedContext(dbPath) {
  const resolved = dbPath
    ? (isAbsolute(dbPath) ? dbPath : join(import.meta.dir, dbPath))
    : join(import.meta.dir, "shared-context.db");
  db = new Database(resolved);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      backend TEXT DEFAULT '',
      role TEXT DEFAULT 'assistant',
      text TEXT NOT NULL,
      tokens INTEGER DEFAULT 0,
      ts INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shared_ctx_chat_ts
    ON shared_context(chat_id, ts)
  `);
}

/**
 * 估算 token 数（与 bridge.js 保持一致）
 */
function estimateTokens(text) {
  const cjkChars = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
  const wordChars = (text.match(/[A-Za-z0-9_]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  const restChars = Math.max(0, text.length - cjkChars - wordChars);
  return cjkChars + words + Math.ceil(restChars / 3);
}

/**
 * 写入一条共享消息（bot 回复后调用）
 */
export function writeSharedMessage(chatId, { source, backend = "", role = "assistant", text }) {
  if (!db || !text) return;
  const tokens = estimateTokens(text);
  db.prepare(
    "INSERT INTO shared_context (chat_id, source, backend, role, text, tokens, ts) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(chatId, source, backend, role, text, tokens, Date.now());
}

/**
 * 读取共享消息（构建 prompt 时调用）
 * @returns {{ source: string, backend: string, role: string, text: string, tokens: number, ts: number }[]}
 */
export function readSharedMessages(chatId, { maxMessages = 30, maxTokens = 3000, ttlMs = 1200000 } = {}) {
  if (!db) return [];
  const minTs = Date.now() - ttlMs;

  // 清理过期数据
  db.prepare("DELETE FROM shared_context WHERE chat_id = ? AND ts < ?").run(chatId, minTs);

  // 读取最近消息（按时间倒序取，再反转）
  const rows = db.prepare(
    "SELECT source, backend, role, text, tokens, ts FROM shared_context WHERE chat_id = ? AND ts >= ? ORDER BY ts DESC LIMIT ?"
  ).all(chatId, minTs, maxMessages);
  rows.reverse();

  // token 裁剪：从最旧的开始丢
  let totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0);
  while (rows.length > 0 && totalTokens > maxTokens) {
    const removed = rows.shift();
    totalTokens -= removed.tokens;
  }

  return rows;
}
