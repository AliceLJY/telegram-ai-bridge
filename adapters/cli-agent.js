// 通用 CLI-agent 适配器工厂
//
// 覆盖「一次性 -p 调用 + 可选会话续接」型 CLI backend：agy（Antigravity / Gemini）、kimi（Moonshot）。
// 两者结构同构（起子进程 → 收 stdout → 解析 → 拿会话 id 供下一轮续接），差异全部收在 spec 里
// （二进制路径 / 参数拼装 / 输出解析），因此不各写一份 400 行。
//
// 为什么不走 ~/scripts/{kimi,codex}-run.sh 那套封装：它们服务的是「CC 交互式调用」场景
// （看门狗止损 + 日志落文件 + Done Gate），而 bridge 需要的是能被 abortSignal 中断的子进程 +
// 直接拿 stdout。封装里最核心的那条防御——stdin 不接 /dev/null 则 CLI 等 EOF 挂死——
// 在这里由 stdio[0] = "ignore" 等价满足。
//
// simplified: 单次调用期间不发心跳 progress，长回答在 TG 侧会静默几十秒（首字即完整答案）。
//   升级路径 = 改用两个 CLI 都支持的 --output-format stream-json，边读边 yield text。
//   现在不做是因为两种 CLI 的 stream-json 事件结构都得先实测，而一次性模式已可用。

import { spawn } from "child_process";

const DEFAULT_TIMEOUT_MS = 600_000;
// 子进程硬杀的额外宽限：让 CLI 自己的 --print-timeout 先触发，拿到它的错误信息更有诊断价值
const KILL_GRACE_MS = 30_000;

export function createCliAgentAdapter(spec, config = {}) {
  const defaultModel = config.model || spec.defaultModel || "";
  const cwd = config.cwd || process.env.CC_CWD || process.env.HOME;
  const timeoutMs = Number(config.timeoutMs || spec.timeoutMs || DEFAULT_TIMEOUT_MS);

  function runCli(args, signal) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(spec.bin, args, {
          cwd,
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"], // stdin=ignore：CLI 不会等 EOF 挂死
        });
      } catch (err) {
        resolve({ code: -1, stdout: "", stderr: `spawn ${spec.bin} 失败: ${err.message}`, killed: false });
        return;
      }

      let stdout = "";
      let stderr = "";
      let killed = false;

      const onAbort = () => {
        killed = true;
        child.kill("SIGTERM");
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, timeoutMs + KILL_GRACE_MS);

      const cleanup = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      };

      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });

      child.on("error", (err) => {
        cleanup();
        resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`.trim(), killed });
      });

      child.on("close", (code) => {
        cleanup();
        resolve({ code, stdout, stderr, killed });
      });
    });
  }

  return {
    name: spec.name,
    label: spec.label,
    icon: spec.icon,

    availableModels() {
      return [
        { id: "__default__", label: `默认 (${defaultModel || "CLI 自带"})` },
        ...(spec.models || []),
      ];
    },

    async *streamQuery(prompt, sessionId, abortSignal, overrides = {}) {
      const model =
        overrides.model && overrides.model !== "__default__" ? overrides.model : defaultModel;
      const effort = overrides.effort || config.defaultEffort || spec.defaultEffort || "";

      const args = spec.buildArgs({ prompt, sessionId, model, effort, timeoutMs });
      const started = Date.now();
      const { code, stdout, stderr, killed } = await runCli(args, abortSignal);
      const duration = Date.now() - started;

      if (killed) {
        yield {
          type: "result",
          success: false,
          text: `${spec.label} 调用被中断（超时或取消）。`,
          cost: null,
          duration,
        };
        return;
      }

      let parsed;
      try {
        parsed = spec.parseResult({ stdout, stderr, code });
      } catch (err) {
        yield {
          type: "result",
          success: false,
          text:
            `${spec.label} 输出解析失败: ${err.message}\n\n` +
            `原始输出(前 500 字):\n${stdout.slice(0, 500) || "(空)"}`,
          cost: null,
          duration,
        };
        return;
      }

      // 会话 id：续轮时沿用传入的，首轮由 CLI 输出里带回来
      const sid = parsed.sessionId || sessionId;
      if (sid) yield { type: "session_init", sessionId: sid };

      if (!parsed.success) {
        yield {
          type: "result",
          success: false,
          text:
            parsed.error ||
            `${spec.label} 调用失败 (exit=${code})\n${(stderr || stdout).slice(0, 400)}`,
          cost: null,
          duration,
        };
        return;
      }

      if (parsed.text) yield { type: "text", text: parsed.text };

      yield {
        type: "result",
        success: true,
        text: parsed.text || "",
        cost: parsed.cost ?? null,
        duration,
      };
    },

    statusInfo(overrideModel) {
      return {
        model: overrideModel || defaultModel || "(CLI 默认)",
        cwd,
        mode: spec.modeLabel || `${spec.label} CLI (-p 非交互)`,
      };
    },

    // listSessions / resolveSession / inspectSession 有意不实现：
    // bridge.js 三处调用点都有 optional 保护（`if (!adapter?.listSessions) return []` 等），
    // 缺失时只是「不支持外部会话浏览/预览」，不影响正常对话。CLI 的会话文件格式
    // （agy: ~/.gemini/antigravity-cli/conversations/、kimi: ~/.kimi-code/）真有需要再补。
  };
}
