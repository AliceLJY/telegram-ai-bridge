// 统一适配器接口定义 + 工厂函数
//
// 每个适配器导出 createAdapter(config) → { name, streamQuery, statusInfo }
// streamQuery 是 async generator，yield 统一事件：
//   { type: "session_init", sessionId }
//   { type: "progress", toolName?, toolIcon?, detail? }
//   { type: "text", text }
//   { type: "result", success, text, cost?, duration? }

import { createAdapter as createClaudeAdapter } from "./claude.js";
import { createAdapter as createCodexAdapter } from "./codex.js";
import { createAdapter as createGeminiAdapter } from "./gemini.js";
import { createAdapter as createAgyAdapter } from "./agy.js";
import { createAdapter as createKimiAdapter } from "./kimi.js";

const ADAPTERS = {
  claude: createClaudeAdapter,
  codex: createCodexAdapter,
  gemini: createGeminiAdapter,
  // agy = Antigravity CLI（Gemini 系模型）。走 CLI 子进程，与上面那个直连 Code Assist API 的
  // gemini backend 是两条独立路径，别因为同属 Google 就以为可以互相替代。
  agy: createAgyAdapter,
  // kimi = Kimi Code CLI（Moonshot 系模型）。与 agy 共用 cli-agent.js 工厂。
  kimi: createKimiAdapter,
};

export function createBackend(name, config = {}) {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new Error(`Unknown backend: ${name}. Available: ${Object.keys(ADAPTERS).join(", ")}`);
  }
  return factory(config);
}

export const AVAILABLE_BACKENDS = Object.keys(ADAPTERS);
