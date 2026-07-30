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
// 两种消费模式（由 spec 决定，实测两个 CLI 的 stream-json 行为不同）：
//   ① 流式（spec.streamParse 存在，agy / kimi 都用）：--output-format stream-json 边读 stdout
//      边 yield text 增量 → bridge 的 streamPreview 实时 editMessage，体验同 CC「边写边出」。
//      实测 agy stream-json 的 step_update 事件带 text_delta（增量，拼接=完整 response，已逐字节验证）。
//      kimi 的流式是 step 粒度（2026-07-30 实测）：多 step 任务的中间帧按 step 边界刷出，
//      单条 LLM 生成内部不做 token 级流式——工具进度可见，最终答案那段仍是一次性到。
//   ② 缓冲（无 streamParse）：等 CLI 跑完拿完整 stdout 再 parseResult。当前无 backend 用，
//      保留给「CLI 的流式输出不可靠」时的回退。
//
// 契约（与 claude.js 一致，防最终消息翻倍）：流式路径逐 delta yield {type:"text"} 只驱动预览，
//   收尾 yield {type:"result", text:<完整 response>}；bridge 主路径用 result.text 当最终消息、
//   text 增量只喂 streamPreview（bridge.js:1353 vs 1330），两者不叠加。

import { spawn } from "child_process";
import { createInterface } from "readline";

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

  // 流式路径：spawn → readline 逐行 → spec.streamParse(line) 归一化 → yield 增量事件。
  // spec.streamParse(line) 返回下列之一（null=忽略该行）：
  //   { sessionId }                          — 带回会话 id（首个出现即 yield session_init）
  //   { kind: "text", delta }                — 正文增量
  //   { kind: "progress", detail, toolName } — 进度（思考/工具，可选）
  //   { kind: "result", success, text, sessionId, error } — 收尾
  async function* runStreaming(args, abortSignal) {
    let child;
    try {
      child = spawn(spec.bin, args, {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      yield { type: "result", success: false, text: `spawn ${spec.bin} 失败: ${err.message}`, duration: 0 };
      return;
    }

    const started = Date.now();
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    let killed = false;
    const onAbort = () => {
      killed = true;
      child.kill("SIGTERM");
    };
    if (abortSignal) {
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs + KILL_GRACE_MS);

    const closePromise = new Promise((resolve) => {
      child.on("close", (code) => resolve(code));
      child.on("error", () => resolve(-1));
    });

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

    let sessionEmitted = false;
    let accumulated = "";
    let finalResult = null;

    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let ev;
        try {
          ev = spec.streamParse(trimmed);
        } catch {
          ev = null; // 半行/噪音容忍
        }
        if (!ev) continue;
        if (ev.sessionId && !sessionEmitted) {
          sessionEmitted = true;
          yield { type: "session_init", sessionId: ev.sessionId };
        }
        if (ev.kind === "text" && ev.delta) {
          accumulated += ev.delta;
          yield { type: "text", text: ev.delta };
        } else if (ev.kind === "progress" && ev.detail) {
          yield { type: "progress", toolName: ev.toolName, detail: ev.detail };
        } else if (ev.kind === "result") {
          finalResult = ev;
        }
      }
    } finally {
      clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
    }

    const code = await closePromise;
    const duration = Date.now() - started;

    if (killed) {
      yield { type: "result", success: false, text: `${spec.label} 调用被中断（超时或取消）。`, duration };
      return;
    }

    if (finalResult) {
      if (finalResult.sessionId && !sessionEmitted) {
        yield { type: "session_init", sessionId: finalResult.sessionId };
      }
      if (!finalResult.success) {
        yield {
          type: "result",
          success: false,
          text: finalResult.error || `${spec.label} 失败 (exit=${code})\n${(stderr || "").slice(0, 400)}`,
          duration,
        };
        return;
      }
      // result.text（完整 response）为准；缺失才退回累积的增量
      yield {
        type: "result",
        success: true,
        text: finalResult.text ?? accumulated,
        cost: finalResult.cost ?? null,
        duration,
      };
      return;
    }

    // 没等到 result 事件：按退出码 + stderr 兜底（stderr 里藏着 agy 的 jetski 权限报错等真信息）
    if (code === 0 && accumulated) {
      yield { type: "result", success: true, text: accumulated, duration };
    } else {
      yield {
        type: "result",
        success: false,
        text: `${spec.label} 未返回结果 (exit=${code})\n${(stderr || "").slice(0, 400) || "(无输出)"}`,
        duration,
      };
    }
  }

  const api = {
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

      // 流式引擎（agy）：spec 提供 streamParse 就走边读边 yield
      if (typeof spec.streamParse === "function") {
        yield* runStreaming(args, abortSignal);
        return;
      }

      // 缓冲引擎（kimi）：等 CLI 跑完一次性解析
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

    // inspectSession 仍不实现：那是「只读预览某会话的历史消息」，要解析各 CLI 的内部
    // 消息格式（agy 的 step_payload 是 blob、kimi 是自有目录结构），成本高且随 CLI 升级易碎。
    // bridge 的 sendSessionPeek 有 `if (!adapter.inspectSession)` 保护，会友好提示不支持。
  };

  // ── 下面几项按 spec 的声明条件暴露 ──────────────────────────────
  // 关键：宁可不暴露方法，也不要暴露一个「返回空/假数据」的方法。
  // bridge 对这几项都是「有函数就用、没有就走自己的默认」，所以缺失比骗它更安全——
  // 例：/effort 若见到 availableEfforts 就完全采信其返回值，kimi 明明不支持逐次指定
  // effort，若让它 fallback 到 bridge 的默认列表(low/medium/high)，用户选了却毫无作用。
  if (spec.efforts) {
    api.availableEfforts = () => spec.efforts;
  }

  if (typeof spec.enumerateSessions === "function") {
    // 轻量版会话浏览（2026-07-30 Alice 选定）：只用各 CLI 现成的索引 + 文件 mtime，
    // 不解析内部 .db / 消息体。代价是列表没有"首条消息"当标题，只能靠时间和工作目录认；
    // 换来的是不依赖任何 CLI 内部 schema，agy / kimi 升级改格式也不会把这里弄坏。
    api.listSessions = async (limit = 10) => {
      try {
        const rows = await spec.enumerateSessions(limit);
        return (rows || []).slice(0, limit).map((r) => ({ ...r, backend: spec.name }));
      } catch {
        return [];
      }
    };

    api.resolveSession = async (sessionId) => {
      if (!sessionId) return null;
      try {
        // 多取一些再按 id 找：会话可能不在最近 N 条里
        const rows = (await spec.enumerateSessions(200)) || [];
        const hit = rows.find((r) => r.session_id === sessionId);
        return hit ? { ...hit, backend: spec.name, cwd: hit.cwd || cwd } : null;
      } catch {
        return null;
      }
    };
  }

  return api;
}
