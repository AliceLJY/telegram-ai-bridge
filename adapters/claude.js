// Claude Agent SDK 适配器
import { query } from "@anthropic-ai/claude-agent-sdk";

export function createAdapter(config = {}) {
  const model = config.model || process.env.CC_MODEL || "claude-sonnet-4-6";
  const cwd = config.cwd || process.env.CC_CWD || process.env.HOME;

  return {
    name: "claude",
    label: "CC",
    icon: "🟣",

    async *streamQuery(prompt, sessionId, abortSignal) {
      const options = {
        model,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        cwd,
      };

      if (sessionId) {
        options.resume = sessionId;
      } else {
        options.settingSources = ["user", "project"];
      }

      // Claude SDK 需要 AbortController 对象，bridge 传来的是 AbortSignal
      const abortController = new AbortController();
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => abortController.abort(), { once: true });
      }

      for await (const msg of query({
        prompt,
        options: { ...options, abortController },
      })) {
        // 捕获 session ID
        if (msg.type === "system" && msg.subtype === "init") {
          yield { type: "session_init", sessionId: msg.session_id };
        }

        // 助手消息 → 进度事件（工具调用 + 文本）
        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "tool_use") {
              yield {
                type: "progress",
                toolName: block.name,
                input: block.input,
              };
            } else if (block.type === "text" && block.text) {
              yield { type: "text", text: block.text };
            }
          }
        }

        // 最终结果
        if (msg.type === "result") {
          yield {
            type: "result",
            success: msg.subtype === "success",
            text: msg.subtype === "success" ? (msg.result || "") : (msg.errors || []).join("\n"),
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
          };
        }
      }
    },

    statusInfo() {
      return { model, cwd, mode: "Agent SDK direct" };
    },
  };
}
