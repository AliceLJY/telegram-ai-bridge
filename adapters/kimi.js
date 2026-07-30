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

import { join } from "path";
import { createCliAgentAdapter } from "./cli-agent.js";

const BIN =
  process.env.KIMI_BIN || join(process.env.HOME || "", ".kimi-code", "bin", "kimi");

export function createAdapter(config = {}) {
  return createCliAgentAdapter(
    {
      name: "kimi",
      label: "Kimi",
      icon: "🌙",
      bin: BIN,
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

      buildArgs({ prompt, sessionId, model }) {
        // stream-json 而非 text：text 模式把 thinking 和答案都渲染成 "• xxx" 段落，
        // 无法可靠区分；stream-json 用 role 字段分得清（实测见 parseResult 注释）。
        const args = ["-p", prompt, "--output-format", "stream-json"];
        if (sessionId) args.push("-S", sessionId);
        if (model) args.push("-m", model);
        return args;
      },

      // stream-json 是 JSON Lines，实测形如：
      //   {"role":"assistant","content":"SJ_OK"}
      //   {"role":"meta","type":"session.resume_hint","session_id":"session_be0a...","command":"kimi -r ..."}
      // 只取 assistant 的 content 拼答案，meta 行取 session_id 供下一轮 -S 续接。
      // 其他 role（thinking / tool 等）忽略——simplified: 不转成 progress 事件，
      // 需要工具调用可视化时再补，届时改这里 yield progress 即可。
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
