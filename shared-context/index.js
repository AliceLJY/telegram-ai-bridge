/**
 * 共享上下文工厂 — 根据配置选择 SQLite / JSON / Redis 后端
 */
import { createSqliteBackend } from "./sqlite.js";
import { createJsonBackend } from "./json.js";
import { createRedisBackend } from "./redis.js";

let backend = null;

const BACKENDS = { sqlite: createSqliteBackend, json: createJsonBackend, redis: createRedisBackend };

/**
 * 初始化共享上下文后端
 * @param {object} config
 * @param {string} [config.sharedContextBackend] - "sqlite" | "json" | "redis"
 * @param {string} [config.sharedContextDb] - SQLite 文件路径
 * @param {string} [config.sharedContextJsonPath] - JSON 文件路径
 * @param {string} [config.redisUrl] - Redis 连接地址
 * @param {string} [config._baseDir] - 相对路径的基准目录
 */
export async function initSharedContext(config) {
  const type = config.sharedContextBackend || "sqlite";
  const factory = BACKENDS[type] || BACKENDS.sqlite;
  backend = factory(config);
  await backend.init();
  console.log(`[shared-context] Backend: ${type}`);
}

/**
 * 写入一条共享消息
 */
export async function writeSharedMessage(chatId, msg) {
  if (!backend) return;
  await backend.write(chatId, msg);
}

/**
 * 读取共享消息
 * @returns {Promise<Array<{ source: string, backend: string, role: string, text: string, tokens: number, ts: number }>>}
 */
export async function readSharedMessages(chatId, opts) {
  if (!backend) return [];
  return backend.read(chatId, opts);
}
