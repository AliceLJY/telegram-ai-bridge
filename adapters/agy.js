// Antigravity CLI (`agy`) 适配器 —— Google Gemini 系模型
//
// ⚠️ 凭证存在 macOS keychain（svce=gemini / acct=antigravity），不是文件：
//   ✅ launchd 的 gui/<uid> domain 能解开 → bridge 由 launchd 拉起，实测可用
//      （2026-07-30 两机各装临时 launchd 探针跑 canary，均 AGY_EXIT=0）
//   ❌ ssh 非交互解不开 → 报 "You are not logged into Antigravity" 后转交互 OAuth 并超时
//   → 排障时别用 `ssh mini 'agy -p ...'` 判断死活，那必然红灯且与 bridge 实际处境无关。
//      要么装个临时 launchd job，要么 `ssh -t` 带伪终端。
//
// 二进制名是 agy 而不是 antigravity（brew: Linking Binary 'antigravity' to '.../agy'）。
// `gemini` CLI 已合并进 agy，不再单独存在——本仓另有一个 gemini backend，那是直连
// Code Assist API 的实现，和这里走 CLI 的路径无关，别混。

import { readdirSync, statSync } from "fs";
import { join } from "path";
import { createCliAgentAdapter } from "./cli-agent.js";

const BIN = process.env.AGY_BIN || "/opt/homebrew/bin/agy";
// agy 每个 conversation 落一个 sqlite：~/.gemini/antigravity-cli/conversations/<uuid>.db
const CONV_DIR = join(process.env.HOME || "", ".gemini", "antigravity-cli", "conversations");
// agy 只认 low|medium|high。这里要挡的是 config 里沿用 codex 的 "ultra"——传过去会被 CLI 拒。
const AGY_EFFORTS = ["low", "medium", "high"];

export function createAdapter(config = {}) {
  return createCliAgentAdapter(
    {
      name: "agy",
      label: "Agy",
      icon: "🟠",
      bin: BIN,
      defaultModel: process.env.AGY_MODEL || "gemini-3.1-pro-high",
      defaultEffort: "high",
      modeLabel: "Antigravity CLI (Gemini)",

      // 只列 Gemini 系。Antigravity 里也能选 claude-*，但这个 bot 的全部意义就是提供一个
      // 非 Claude 的引擎；把同源模型摆进菜单只会让人误选成回音。
      models: [
        { id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
        { id: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
        { id: "gemini-3.6-flash-high", label: "Gemini 3.6 Flash (High)" },
        { id: "gemini-3.6-flash-medium", label: "Gemini 3.6 Flash (Medium)" },
        { id: "gemini-3.5-flash-high", label: "Gemini 3.5 Flash (High)" },
      ],

      // agy 支持逐次指定 --effort（low|medium|high），所以给出真实档位
      efforts: [
        { id: "__default__", label: "默认 (high)", description: "跟随 adapter 默认档" },
        { id: "low", label: "Low", description: "轻量思考，最快" },
        { id: "medium", label: "Medium", description: "中等思考深度" },
        { id: "high", label: "High", description: "深度思考，最慢" },
      ],

      // 轻量会话枚举：只列 conversation 文件 + mtime，不打开 .db。
      // 内部表是 trajectory_meta / steps / *_blob，step_payload 是 blob——解析它才能拿到
      // "首条消息"当标题，但那是 agy 内部格式，升级即碎，故按 YAGNI 不做。
      enumerateSessions(limit = 10) {
        let files;
        try {
          files = readdirSync(CONV_DIR).filter((f) => f.endsWith(".db"));
        } catch {
          return [];
        }
        const rows = [];
        for (const f of files) {
          try {
            const st = statSync(join(CONV_DIR, f));
            const id = f.replace(/\.db$/, "");
            rows.push({
              session_id: id,
              display_name: `agy 会话 ${id.slice(0, 8)}`,
              last_active: st.mtimeMs,
            });
          } catch {
            /* 单个文件读不到就跳过，不影响其余 */
          }
        }
        rows.sort((a, b) => b.last_active - a.last_active);
        return rows.slice(0, Math.max(limit, 1));
      },

      buildArgs({ prompt, sessionId, model, effort, timeoutMs }) {
        const args = ["-p", prompt, "--output-format", "json"];
        args.push("--print-timeout", `${Math.round(timeoutMs / 1000)}s`);
        if (sessionId) args.push("--conversation", sessionId);
        if (model) args.push("--model", model);
        if (effort && AGY_EFFORTS.includes(effort)) args.push("--effort", effort);
        return args;
      },

      // json 模式返回单行：
      // {"conversation_id":"...","status":"SUCCESS","response":"...","duration_seconds":5.8,
      //  "num_turns":1,"usage":{"input_tokens":...,"output_tokens":...,"total_tokens":...}}
      parseResult({ stdout, stderr, code }) {
        const trimmed = stdout.trim();
        // 保险：agy 偶尔在 JSON 前打日志行，从后往前找第一个 { 开头的行
        const jsonLine = trimmed.startsWith("{")
          ? trimmed
          : trimmed
              .split("\n")
              .reverse()
              .find((line) => line.trim().startsWith("{"));

        if (!jsonLine) {
          return {
            success: false,
            error:
              `agy 未返回 JSON (exit=${code})\n` +
              `${(stderr || stdout).slice(0, 400) || "(无输出)"}`,
          };
        }

        const data = JSON.parse(jsonLine);
        const ok = data.status === "SUCCESS";
        return {
          success: ok,
          text: data.response || "",
          sessionId: data.conversation_id || null,
          error: ok ? null : `agy status=${data.status || "(未知)"}`,
        };
      },
    },
    config
  );
}
