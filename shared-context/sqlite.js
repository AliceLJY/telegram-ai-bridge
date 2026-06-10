/**
 * SQLite 后端 — 保持现有逻辑，WAL 模式
 */
import { Database } from "bun:sqlite";
import { join, isAbsolute } from "path";
import { estimateTokens, trimByTokens } from "./utils.js";

export function createSqliteBackend(config) {
  let db = null;
  const dbPath = config.sharedContextDb || "shared-context.db";
  const busyTimeoutMs = 5000;
  // WAL 只在 checkpoint 或干净关闭时回收，长跑下会无界增长（实测 -wal 涨到 2.2M），借 read 节流截断
  const CHECKPOINT_INTERVAL_MS = 30 * 60 * 1000;
  let lastCheckpointTs = 0;

  return {
    async init() {
      const resolved = isAbsolute(dbPath)
        ? dbPath
        : join(config._baseDir || import.meta.dir, dbPath);
      db = new Database(resolved);
      db.run("PRAGMA journal_mode = WAL");
      db.run(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      db.run(`
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
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_shared_ctx_chat_ts
        ON shared_context(chat_id, ts)
      `);
    },

    async write(chatId, { source, backend = "", role = "assistant", text }) {
      if (!db || !text) return;
      const tokens = estimateTokens(text);
      db.prepare(
        "INSERT INTO shared_context (chat_id, source, backend, role, text, tokens, ts) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(chatId, source, backend, role, text, tokens, Date.now());
    },

    async read(chatId, { maxMessages = 30, maxTokens = 3000, ttlMs = 1200000 } = {}) {
      if (!db) return [];
      const minTs = Date.now() - ttlMs;

      // 清理过期数据
      try {
        db.prepare("DELETE FROM shared_context WHERE chat_id = ? AND ts < ?").run(chatId, minTs);
        if (Date.now() - lastCheckpointTs > CHECKPOINT_INTERVAL_MS) {
          db.run("PRAGMA wal_checkpoint(TRUNCATE)");
          lastCheckpointTs = Date.now();
        }
      } catch (error) {
        if (!/database is locked/i.test(error.message)) throw error;
        console.warn(`[shared-context:sqlite] cleanup skipped: ${error.message}`);
      }

      // 读取最近消息（按时间倒序取，再反转）
      const rows = db.prepare(
        "SELECT source, backend, role, text, tokens, ts FROM shared_context WHERE chat_id = ? AND ts >= ? ORDER BY ts DESC LIMIT ?"
      ).all(chatId, minTs, maxMessages);
      rows.reverse();

      return trimByTokens(rows, maxTokens);
    },

    async close() {
      if (!db) return;
      try {
        db.run("PRAGMA wal_checkpoint(TRUNCATE)");
        db.close();
      } catch {}
      db = null;
    },
  };
}
