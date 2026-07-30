// Kimi Code CLI 适配器 —— Moonshot 系模型
//
// 凭证是文件（~/.kimi-code/credentials/kimi-code.json，0600 同属主），不是 keychain，
// 所以 ssh 非交互 / launchd 都能读——这点和 agy 正好相反，排障时别把两者的结论混用。
//
// ⚠️ 二进制不在 PATH 里：装在 ~/.kimi-code/bin/kimi，`command -v kimi` 一定找不到。
//    别拿它当「没装」的判据（踩过一次）。
//
// 权限模式：-p 与 --auto/--yolo 互斥（0.27.0 实证 OptionConflictError），所以一律不传，
// 权限吃 config.toml 的 default_permission_mode（当前 = yolo）。要限制就在 prompt 里说。

import { readFileSync, statSync } from "fs";
import { join, basename } from "path";
import { createCliAgentAdapter } from "./cli-agent.js";

// 从 tool_call 的 arguments（JSON 字符串）里挑一个最说明问题的字段当进度摘要，
// 字段优先级照 progress.js 的 input 摘要习惯；解析失败静默返回空（进度条少一行字而已）。
function summarizeToolArgs(argsJson) {
  if (typeof argsJson !== "string" || !argsJson) return "";
  try {
    const a = JSON.parse(argsJson);
    if (!a || typeof a !== "object") return "";
    const v = a.command || a.file_path || a.path || a.description || a.pattern || a.query || "";
    return typeof v === "string" ? v.slice(0, 60) : "";
  } catch {
    return "";
  }
}

const DEFAULT_BIN = join(process.env.HOME || "", ".kimi-code", "bin", "kimi");
// kimi 自带会话索引，每行一条 {sessionId, sessionDir, workDir}——不用扫目录
const SESSION_INDEX = join(process.env.HOME || "", ".kimi-code", "session_index.jsonl");

export function createAdapter(config = {}) {
  return createCliAgentAdapter(
    {
      name: "kimi",
      label: "Kimi",
      icon: "🌙",
      // 在 createAdapter 内读 env（而非模块级常量）：测试可以逐用例换假 CLI
      bin: process.env.KIMI_BIN || DEFAULT_BIN,
      // 留空 = 吃 config.toml 的 default_model（当前 kimi-code/k3）。
      // 不硬编码，这样改 config.toml 立刻生效，不用动代码。
      defaultModel: process.env.KIMI_MODEL || "",
      modeLabel: "Kimi Code CLI (-p 非交互)",

      models: [
        { id: "kimi-code/k3", label: "K3" },
        { id: "kimi-code/k3-256k", label: "K3-256k" },
        { id: "kimi-code/kimi-for-coding", label: "K2.7 Coding" },
        { id: "kimi-code/kimi-for-coding-highspeed", label: "K2.7 Coding Highspeed" },
      ],

      // ⚠️ 只给"默认"一档，且明说原因。kimi CLI 没有 --effort（thinking effort 在
      // ~/.kimi-code/config.toml 的 [thinking] 段，是全局设定，不能逐次指定）。
      // 若不声明这项，bridge 的 /effort 会 fallback 到它自己的 low/medium/high 默认列表——
      // 那对 kimi 是假选项：用户选了、界面也确认了，实际一点作用都没有。
      efforts: [
        {
          id: "__default__",
          label: "默认（kimi 不支持逐次指定）",
          description: "thinking effort 跟随 ~/.kimi-code/config.toml 的 [thinking] 段，当前 high",
        },
      ],

      // 轻量会话枚举：直接读 kimi 自带的 session_index.jsonl，用 sessionDir 的 mtime
      // 当最后活跃时间；workDir 的 basename 当标题（比纯 id 有信息）。不解析会话内容。
      enumerateSessions(limit = 10) {
        let lines;
        try {
          lines = readFileSync(SESSION_INDEX, "utf8").split("\n").filter(Boolean);
        } catch {
          return [];
        }
        const rows = [];
        for (const ln of lines) {
          let o;
          try {
            o = JSON.parse(ln);
          } catch {
            continue;
          }
          if (!o.sessionId) continue;
          let mtime = 0;
          try {
            if (o.sessionDir) mtime = statSync(o.sessionDir).mtimeMs;
          } catch {
            /* 目录可能已被清理，仍保留索引条目，时间按 0 排到最后 */
          }
          const wd = o.workDir ? basename(o.workDir) : "";
          rows.push({
            session_id: o.sessionId,
            display_name: `kimi ${o.sessionId.replace(/^session_/, "").slice(0, 8)}${wd ? ` @${wd}` : ""}`,
            last_active: mtime,
            cwd: o.workDir || undefined,
          });
        }
        rows.sort((a, b) => b.last_active - a.last_active);
        return rows.slice(0, Math.max(limit, 1));
      },

      buildArgs({ prompt, sessionId, model }) {
        // stream-json 而非 text：text 模式把 thinking 和答案都渲染成 "• xxx" 段落，
        // 无法可靠区分；stream-json 用 role 字段分得清（实测见 parseResult 注释）。
        const args = ["-p", prompt, "--output-format", "stream-json"];
        if (sessionId) args.push("-S", sessionId);
        if (model) args.push("-m", model);
        return args;
      },

      // 流式解析（2026-07-30 补，实测修正）：kimi stream-json 按 agent 循环的 step 边界刷帧——
      // 多 step 任务（工具调用链）的中间帧在 turn 结束前就写出，只是单条 LLM 生成内部不做
      // token 级流式。所以正文靠完整消息帧累积，工具调用帧转 progress 事件喂 progress.js。
      // 帧清单（实测 + 官方文档）：assistant(content|tool_calls) / tool / meta(session.resume_hint)；
      // thinking 不写 JSONL，工具进度走 stderr，错误 = stderr 明文 + exit≠0（无 error 帧）。
      streamParse(line) {
        if (!line.startsWith("{")) return null;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          return null; // 半行/噪音容忍
        }
        if (o.role === "assistant") {
          // 正文帧是完整消息（非增量）；全部累积 = 完整 response，与下方 parseResult 语义一致
          if (typeof o.content === "string" && o.content) {
            return { kind: "text", delta: o.content };
          }
          if (Array.isArray(o.tool_calls) && o.tool_calls.length) {
            const call = o.tool_calls[0];
            return {
              kind: "progress",
              toolName: call?.function?.name || "tool",
              detail: summarizeToolArgs(call?.function?.arguments),
            };
          }
          return null;
        }
        // tool 结果帧不转事件：不进最终答案，刷 progress 只有噪音
        if (o.role === "meta" && o.session_id) {
          // 收尾帧：text 置 null → cli-agent 回退用累积正文
          return { kind: "result", success: true, text: null, sessionId: o.session_id };
        }
        return null;
      },

      // 一次性解析：保留给非流式 fallback / 手动调用（当前 streamParse 存在则不走这里）。
      // stream-json 是 JSON Lines，实测形如：
      //   {"role":"assistant","content":"SJ_OK"}
      //   {"role":"meta","type":"session.resume_hint","session_id":"session_be0a...","command":"kimi -r ..."}
      // 只取 assistant 的 content 拼答案，meta 行取 session_id 供下一轮 -S 续接。
      parseResult({ stdout, stderr, code }) {
        let text = "";
        let sessionId = null;
        let sawJson = false;

        for (const line of stdout.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("{")) continue;
          let obj;
          try {
            obj = JSON.parse(trimmed);
          } catch {
            continue; // 容忍半行 / 非 JSON 噪音
          }
          sawJson = true;
          if (obj.role === "assistant" && typeof obj.content === "string") {
            text += obj.content;
          } else if (obj.role === "meta" && obj.session_id) {
            sessionId = obj.session_id;
          }
        }

        if (!sawJson) {
          return {
            success: false,
            error:
              `kimi 未返回 stream-json (exit=${code})\n` +
              `${(stderr || stdout).slice(0, 400) || "(无输出)"}`,
          };
        }

        const ok = code === 0 && text.trim().length > 0;
        return {
          success: ok,
          text,
          sessionId,
          error: ok
            ? null
            : `kimi 无有效回答 (exit=${code})\n${(stderr || "").slice(0, 300)}`,
        };
      },
    },
    config
  );
}
