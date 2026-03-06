// Claude Agent SDK 适配器
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdirSync, statSync, createReadStream } from "fs";
import { basename, join } from "path";
import { createInterface } from "readline";

export function createAdapter(config = {}) {
  const defaultModel = config.model || process.env.CC_MODEL || "claude-sonnet-4-6";
  const cwd = config.cwd || process.env.CC_CWD || process.env.HOME;
  const permMode = process.env.CC_PERMISSION_MODE || "default";

  function listSessionFiles(limit = 10) {
    const projectsDir = join(process.env.HOME, ".claude", "projects");
    const allFiles = [];

    try {
      const dirs = readdirSync(projectsDir).filter(d => {
        try { return statSync(join(projectsDir, d)).isDirectory(); } catch { return false; }
      });
      for (const dir of dirs) {
        const fullDir = join(projectsDir, dir);
        try {
          const files = readdirSync(fullDir)
            .filter(f => f.endsWith(".jsonl"))
            .map(f => {
              const fp = join(fullDir, f);
              const stat = statSync(fp);
              return { file: f, path: fp, mtime: stat.mtimeMs, size: stat.size, sessionId: f.replace(".jsonl", "") };
            });
          allFiles.push(...files);
        } catch { /* skip */ }
      }
    } catch {
      return [];
    }

    allFiles.sort((a, b) => b.mtime - a.mtime);
    return allFiles.slice(0, limit);
  }

  function findSessionFile(sessionId) {
    const projectsDir = join(process.env.HOME, ".claude", "projects");
    try {
      const dirs = readdirSync(projectsDir);
      for (const dir of dirs) {
        const fullDir = join(projectsDir, dir);
        try {
          if (!statSync(fullDir).isDirectory()) continue;
        } catch {
          continue;
        }
        const match = readdirSync(fullDir).find(f => f === `${sessionId}.jsonl`);
        if (match) {
          const path = join(fullDir, match);
          const stat = statSync(path);
          return { file: match, path, mtime: stat.mtimeMs, size: stat.size, sessionId };
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  async function parseSessionFile(fileInfo) {
    let topic = "";
    let resolvedCwd = "";

    try {
      const stream = createReadStream(fileInfo.path, { encoding: "utf8" });
      const rl = createInterface({ input: stream });
      for await (const line of rl) {
        try {
          const d = JSON.parse(line);
          if (!resolvedCwd && typeof d.cwd === "string" && d.cwd) {
            resolvedCwd = d.cwd;
          }
          if (d.message?.role === "user") {
            const content = d.message.content;
            if (Array.isArray(content)) {
              const txt = content.find(c => typeof c === "object" && c.type === "text");
              if (txt?.text) topic = txt.text.slice(0, 80);
            } else if (typeof content === "string") {
              topic = content.slice(0, 80);
            }
            if (topic && !topic.startsWith("[Request interrupted")) break;
            topic = "";
          }
        } catch { /* skip */ }
      }
      rl.close();
      stream.destroy();
    } catch { /* skip */ }

    const finalCwd = resolvedCwd || cwd;
    return {
      session_id: fileInfo.sessionId,
      display_name: topic || "(空)",
      last_active: fileInfo.mtime,
      backend: "claude",
      cwd: finalCwd,
      project_name: basename(finalCwd) || finalCwd,
      session_source: "CLI",
    };
  }

  return {
    name: "claude",
    label: "CC",
    icon: "🟣",

    availableModels() {
      return [
        { id: "__default__", label: `默认 (${defaultModel})` },
        { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
        { id: "claude-opus-4-6", label: "Opus 4.6" },
        { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
      ];
    },

    async *streamQuery(prompt, sessionId, abortSignal, overrides = {}) {
      const { requestPermission, ...restOverrides } = overrides;
      const model = (restOverrides.model && restOverrides.model !== "__default__") ? restOverrides.model : defaultModel;
      const options = {
        model,
        permissionMode: permMode,
        ...(permMode === "bypassPermissions" && { allowDangerouslySkipPermissions: true }),
        cwd,
      };

      // Tool approval: forward permission requests to Telegram
      if (requestPermission && permMode !== "bypassPermissions") {
        options.canUseTool = async (toolName, input, sdkOptions) => {
          return await requestPermission(toolName, input, sdkOptions);
        };
      }

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
              // AskUserQuestion: 提取完整问题+选项
              if (block.name === "AskUserQuestion" && block.input?.questions) {
                for (const q of block.input.questions) {
                  yield {
                    type: "question",
                    question: q.question || "",
                    header: q.header || "",
                    options: (q.options || []).map(o => ({
                      label: o.label,
                      description: o.description || "",
                    })),
                    multiSelect: q.multiSelect || false,
                  };
                }
              }
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

    statusInfo(overrideModel) {
      return { model: overrideModel || defaultModel, cwd, mode: "Agent SDK direct" };
    },

    async listSessions(limit = 10) {
      const recent = listSessionFiles(limit);
      const results = [];
      for (const s of recent) {
        results.push(await parseSessionFile(s));
      }
      return results;
    },

    async resolveSession(sessionId) {
      const fileInfo = findSessionFile(sessionId);
      if (!fileInfo) return null;
      return await parseSessionFile(fileInfo);
    },
  };
}
