/**
 * JSON 文件后端 — 原子写（write tmp + rename），零依赖
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import { join, isAbsolute } from "path";
import { estimateTokens, trimByTokens } from "./utils.js";

export function createJsonBackend(config) {
  const filePath = (() => {
    const p = config.sharedContextJsonPath || "shared-context.json";
    return isAbsolute(p) ? p : join(config._baseDir || import.meta.dir, p);
  })();

  function loadData() {
    if (!existsSync(filePath)) return {};
    try {
      return JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      return {};
    }
  }

  function saveData(data) {
    const tmp = `${filePath}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data), "utf8");
    renameSync(tmp, filePath);
  }

  return {
    async init() {
      if (!existsSync(filePath)) saveData({});
    },

    async write(chatId, { source, backend = "", role = "assistant", text }) {
      if (!text) return;
      const data = loadData();
      const key = String(chatId);
      if (!data[key]) data[key] = [];
      data[key].push({
        source,
        backend,
        role,
        text,
        tokens: estimateTokens(text),
        ts: Date.now(),
      });
      saveData(data);
    },

    async read(chatId, { maxMessages = 30, maxTokens = 3000, ttlMs = 1200000 } = {}) {
      const data = loadData();
      const key = String(chatId);
      let entries = data[key] || [];
      const minTs = Date.now() - ttlMs;

      // 清理过期
      const before = entries.length;
      entries = entries.filter((e) => e.ts >= minTs);
      if (entries.length !== before) {
        data[key] = entries;
        saveData(data);
      }

      // 取最新 maxMessages 条
      if (entries.length > maxMessages) {
        entries = entries.slice(-maxMessages);
      }

      return trimByTokens(entries, maxTokens);
    },
  };
}
