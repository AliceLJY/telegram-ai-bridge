// Claude Agent SDK 适配器
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdirSync, statSync, createReadStream } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

// SDK 0.2.117+ 砍掉了 SDK 内置的 cli.js，必须显式传 claude CLI 路径。
// 优先走环境变量（方便 launchd 兜底），否则用 Alice 两台机通用的 ~/.local/bin/claude。
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH || join(homedir(), ".local/bin/claude");

// 让 bridge 产生的 session 也能出现在终端 `/resume` 列表里。
// CC 2.1.104+ 会按 entrypoint ∈ {sdk-cli, sdk-ts, sdk-py} 过滤掉 SDK 来源 session；
// SDK 的 env 注入是条件性的 (`if (!CLAUDE_CODE_ENTRYPOINT) = "sdk-ts"`)，
// 我们提前占位成 "cli"，SDK 就不会覆盖，子进程写入 jsonl 时记为 entrypoint:"cli"。
// 回滚方法：删掉这 3 行。
if (!process.env.CLAUDE_CODE_ENTRYPOINT) {
  process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
}

// 从 user message content 提取纯文本。tool_result 也会以 role=user 出现，不能当成用户新输入。
export function extractUserText(content) {
  if (Array.isArray(content)) {
    const txt = content.find(c => typeof c === "object" && c.type === "text");
    return txt?.text || "";
  }
  return typeof content === "string" ? content : "";
}

// 剥离 bridge hint / 图片标记等前缀，返回用户真正说的话。
const BRIDGE_HINT_RE = /^\[系统提示:.*?\]\s*/s;
const FILE_TAG_RE = /\n?\[(?:图片文件|文件):.*$/s;
export function cleanUserTopic(raw) {
  if (!raw || raw.startsWith("[Request interrupted")) return "";
  return raw.replace(BRIDGE_HINT_RE, "").replace(FILE_TAG_RE, "").trim();
}

export function hasQueuedCommandAfterLastTextUser(records = []) {
  let lastTextUserIndex = -1;
  let lastQueuedCommandIndex = -1;

  records.forEach((record, index) => {
    if (record?.type === "attachment" && record.attachment?.type === "queued_command") {
      lastQueuedCommandIndex = index;
      return;
    }

    if (record?.type === "user" && record.message?.role === "user") {
      const cleaned = cleanUserTopic(extractUserText(record.message.content));
      // CLI 自注入的伪 user + bridge 自己之前喂的提示都不算真 user text
      if (cleaned && cleaned !== FAKE_USER_RESUME_HINT && !isBridgeOwnPrompt(cleaned)) lastTextUserIndex = index;
    }
  });

  return lastQueuedCommandIndex > lastTextUserIndex;
}

// 检测 jsonl 末尾是否有 CLI 自注入伪 user 出现在最后一条真 user text 之后。
// 用于 resume 路径下提醒 CC 忽略伪 user。
export function hasFakeUserAfterLastRealUser(records = []) {
  let lastRealUserIndex = -1;
  let lastFakeUserIndex = -1;
  records.forEach((r, i) => {
    if (r?.type !== "user" || r.message?.role !== "user") return;
    const text = cleanUserTopic(extractUserText(r.message.content));
    if (!text) return;
    if (text === FAKE_USER_RESUME_HINT) {
      lastFakeUserIndex = i;
    } else if (!isBridgeOwnPrompt(text)) {
      // bridge 自己之前喂的提示不算真 user，避免误判 fake user 在它之后
      lastRealUserIndex = i;
    }
  });
  return lastFakeUserIndex > lastRealUserIndex;
}

// resume 模式下 SDK 启动会往 jsonl 注入 "Continue from where you left off." 当作伪 user，
// 但仅当 jsonl 里已有真 user/assistant 历史时才会注入（首次 query 的空 session 不会）。
// bridge 在 query 前读 jsonl 时这条还没写入，所以 hasFakeUserAfterLastRealUser 看不到。
// 这个 helper 预判「下次 SDK 启动会注入伪 user」，让 streamQuery 提前对冲。
export function hasResumableHistory(records = []) {
  for (const r of records) {
    if (!r) continue;
    if (r.type === "user" && r.message?.role === "user") {
      const text = cleanUserTopic(extractUserText(r.message.content));
      if (text && text !== FAKE_USER_RESUME_HINT && !isBridgeOwnPrompt(text)) {
        return true;
      }
    } else if (r.type === "assistant" && r.message?.role === "assistant") {
      const blocks = Array.isArray(r.message.content) ? r.message.content : [];
      if (blocks.some(b => b && b.type === "text" && typeof b.text === "string" && b.text.trim())) {
        return true;
      }
    }
  }
  return false;
}

// 检测一次 query 完成后，jsonl 增量里是否有"无 isMeta 的 'Continue from where you left off.'"。
// 这条是 SDK resume 启动时为了处理 deferred_tools_delta（MCP 工具集断连/重连）自起内部 turn 写的伪 user。
// 模型基于这条伪 user 立刻起 turn 误读，bridge 传入的 effectivePrompt 要等这个 turn 结束才被消费。
// 注意：isMeta=true 的同款字符串是 SDK deferred tool resume 路径（CLI 内部 `n$()` 注入），跟今晚事故不同源，跳过。
export function detectFakeUserTurnInRecords(records = []) {
  for (const r of records) {
    if (!r) continue;
    if (r.type !== "user" || r.message?.role !== "user") continue;
    if (r.isMeta === true) continue;  // SDK 内部 deferred tool resume，不重跑
    const text = cleanUserTopic(extractUserText(r.message.content));
    if (text === FAKE_USER_RESUME_HINT) return true;
  }
  return false;
}

// 读 jsonl 中 sinceSize 字节之后的新 records（query 后的增量）。
// 配合 detectFakeUserTurnInRecords 做双 yield 兜底。
async function readSessionRecordsAfter(fileInfo, sinceSize, maxBytes = 1024 * 1024) {
  const records = [];
  if (!fileInfo || !fileInfo.path) return records;

  let currentSize;
  try {
    currentSize = statSync(fileInfo.path).size || 0;
  } catch {
    return records;
  }
  if (currentSize <= sinceSize) return records;

  const start = Math.max(0, sinceSize);
  const end = Math.min(currentSize, start + maxBytes);

  try {
    const stream = createReadStream(fileInfo.path, { encoding: "utf8", start, end });
    const rl = createInterface({ input: stream });
    for await (const line of rl) {
      if (!String(line || "").trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // 偏移如果落在行中间，第一行可能是 partial，JSON.parse 会失败 → 跳过
      }
    }
  } catch {
    // swallow，返回已收集的部分
  }

  return records;
}

// queued_command.prompt 在线上 jsonl 是 string，但测试 fixture 历史用过数组形态；做一层归一。
function normalizeQueuedPrompt(prompt) {
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .filter(p => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
      .map(p => p.text)
      .join("");
  }
  return "";
}

// 抓 jsonl 尾部最后一条 user text 之后、被 CLI 写成 queued_command 但未消费的用户输入。
// 仅 commandMode === "prompt" 才算用户输入；task-notification 等 CLI 后台通知不抓。
export function extractOrphanedQueuedPrompts(records = []) {
  let lastTextUserIndex = -1;
  records.forEach((record, index) => {
    if (record?.type === "user" && record.message?.role === "user") {
      const cleaned = cleanUserTopic(extractUserText(record.message.content));
      // 伪 user 不算 lastTextUserIndex，避免漏抓在伪 user 之后的孤魂
      if (cleaned && cleaned !== FAKE_USER_RESUME_HINT) lastTextUserIndex = index;
    }
  });

  const out = [];
  records.forEach((record, index) => {
    if (index <= lastTextUserIndex) return;
    if (record?.type !== "attachment") return;
    const att = record.attachment;
    if (!att || att.type !== "queued_command") return;
    if (att.commandMode !== "prompt") return;
    const text = normalizeQueuedPrompt(att.prompt).trim();
    // bridge 自己之前喂的提示不算用户孤魂，避免无限递归嵌套
    if (text && !isBridgeOwnPrompt(text)) out.push(text);
  });
  return out;
}

// B+ 路线 1：抓 jsonl 尾部最近 maxTurns 轮真实 user/assistant text，过滤 CLI 自注入伪 user。
// 单轮超 perTurnCap 截尾标 …[已截断]；返回时间序数组（最早→最晚）。
const FAKE_USER_RESUME_HINT = "Continue from where you left off.";
// bridge 自己注入到 prompt 头部的提示标记。jsonl 写入后，下次扫描必须跳过它，避免无限递归嵌套。
// 含历史格式（[Bridge 提示：）+ 当前增强格式（真问题前置以【当前真实输入开头）。
const BRIDGE_OWN_PROMPT_MARKERS = ["[Bridge 提示：", "【当前真实输入"];
function isBridgeOwnPrompt(text) {
  return typeof text === "string" && BRIDGE_OWN_PROMPT_MARKERS.some(m => text.startsWith(m));
}
export function extractRecentTurns(records = [], maxTurns = 6, perTurnCap = 2000) {
  const turns = [];
  for (const r of records) {
    if (!r) continue;
    if (r.type === "user" && r.message?.role === "user") {
      const raw = extractUserText(r.message.content);
      const text = cleanUserTopic(raw);
      if (!text) continue;
      if (text === FAKE_USER_RESUME_HINT) continue;
      if (isBridgeOwnPrompt(text)) continue;  // bridge 自喂提示不当历史轮回放
      turns.push({ role: "user", text: capText(text, perTurnCap), ts: r.timestamp });
    } else if (r.type === "assistant" && r.message?.role === "assistant") {
      const blocks = Array.isArray(r.message.content) ? r.message.content : [];
      const text = blocks
        .filter(b => b && b.type === "text" && typeof b.text === "string")
        .map(b => b.text)
        .join("");
      if (!text.trim()) continue;
      turns.push({ role: "assistant", text: capText(text, perTurnCap), ts: r.timestamp });
    }
  }
  return turns.slice(-maxTurns);
}

function capText(text, cap) {
  if (typeof text !== "string") return "";
  if (text.length <= cap) return text;
  return text.slice(0, cap) + "\n…[已截断]";
}

async function readRecentSessionRecords(fileInfo, maxBytes = 1024 * 1024) {
  const records = [];
  const start = Math.max(0, (fileInfo.size || 0) - maxBytes);

  try {
    const stream = createReadStream(fileInfo.path, { encoding: "utf8", start });
    const rl = createInterface({ input: stream });
    let firstLine = true;

    for await (const line of rl) {
      if (firstLine && start > 0) {
        firstLine = false;
        continue;
      }
      firstLine = false;
      if (!String(line || "").trim()) continue;

      try {
        records.push(JSON.parse(line));
      } catch {
        // Tail reads can begin mid-line; ignore partial/corrupt records.
      }
    }

    rl.close();
    stream.destroy();
  } catch {
    return [];
  }

  return records;
}

export function createAdapter(config = {}) {
  const defaultModel = config.model || process.env.CC_MODEL || "claude-sonnet-4-7";
  const cwd = config.cwd || process.env.CC_CWD || process.env.HOME;
  const permMode = process.env.CC_PERMISSION_MODE || "default";

  // Claude SDK 不支持并发 query()（两个子进程会冲突），用锁串行化
  let queryQueue = Promise.resolve();

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
    let firstTopic = "";
    let lastTopic = "";
    let resolvedCwd = "";

    // 单次流式扫描：取 cwd + firstTopic + lastTopic
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
            const cleaned = cleanUserTopic(extractUserText(d.message.content));
            if (cleaned) {
              if (!firstTopic) firstTopic = cleaned.slice(0, 80);
              lastTopic = cleaned.slice(0, 80);
            }
          }
        } catch { /* skip */ }
      }
      rl.close();
      stream.destroy();
    } catch { /* skip */ }

    const finalCwd = resolvedCwd || cwd;
    return {
      session_id: fileInfo.sessionId,
      display_name: lastTopic || firstTopic || "(空)",
      last_active: fileInfo.mtime,
      backend: "claude",
      cwd: finalCwd,
      project_name: basename(finalCwd) || finalCwd,
      session_source: "CLI",
    };
  }

  async function shouldSkipUnsafeResume(sessionId) {
    const fileInfo = findSessionFile(sessionId);
    if (!fileInfo) return false;
    const records = await readRecentSessionRecords(fileInfo);
    return hasQueuedCommandAfterLastTextUser(records);
  }

  return {
    name: "claude",
    label: "CC",
    icon: "🟣",

    availableModels() {
      return [
        { id: "__default__", label: `默认 (${defaultModel})` },
        { id: "claude-sonnet-4-7", label: "Sonnet 4.7" },
        { id: "claude-opus-4-7", label: "Opus 4.7" },
        { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
        { id: "claude-opus-4-6", label: "Opus 4.6" },
        { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
      ];
    },

    availableEfforts() {
      return [
        { id: "__default__", label: `默认 (${process.env.DEFAULT_EFFORT || "high"})`, description: "标准思考深度" },
        { id: "low", label: "Low", description: "最快速，轻量思考" },
        { id: "medium", label: "Medium", description: "中等思考深度" },
        { id: "high", label: "High ✦", description: "标准深度思考" },
        { id: "xhigh", label: "XHigh", description: "超深度思考" },
        { id: "max", label: "Max", description: "最深度思考（仅 Opus）" },
      ];
    },

    async *streamQuery(prompt, sessionId, abortSignal, overrides = {}) {
      // 排队等前一个 query 完成（Claude SDK 不支持并发子进程）
      let releaseLock;
      const myLock = new Promise((r) => { releaseLock = r; });
      const waitForTurn = queryQueue;
      queryQueue = myLock;
      await waitForTurn;

      // 整个 setup + query 包在 try/finally 里，确保 releaseLock 一定被调用
      // 防止 setup 阶段抛异常或 generator 被 abandon 时锁死队列
      try {
      const {
        requestPermission,
        allowedTools: overrideAllowedTools,
        permissionMode: overridePermMode,
        persistSession: overridePersistSession,
        maxTurns: overrideMaxTurns,
        effort: overrideEffort,
        settingSources: overrideSettingSources,
        systemAppend: overrideSystemAppend,
        ...restOverrides
      } = overrides;
      // 方案 B：永远 resume 同 sessionId（不再切 session 推 🟣 通知）。
      // 检测 jsonl 末尾的孤魂 queued_command + 伪 user，在 prompt 头加提示让 CC 忽略它们按当前输入回应。
      // 注意：SDK 启动 resume 时会往 jsonl 注入新的伪 user，bridge 读 jsonl 时这条还没写入。
      // 所以光检测当前 jsonl 不够，要预判「下次 SDK 启动必然会注入伪 user」并提前对冲。
      let orphanedPrompts = [];
      let fakeUserPolluted = false;
      let willHaveFakeUser = false;
      if (sessionId) {
        const fileInfo = findSessionFile(sessionId);
        if (fileInfo) {
          const records = await readRecentSessionRecords(fileInfo);
          if (hasQueuedCommandAfterLastTextUser(records)) {
            orphanedPrompts = extractOrphanedQueuedPrompts(records);
          }
          fakeUserPolluted = hasFakeUserAfterLastRealUser(records);
          // jsonl 还没现成伪 user，但已有 user/assistant 历史 → SDK 这次 resume 启动会再注入一条
          willHaveFakeUser = !fakeUserPolluted && hasResumableHistory(records);
        }
      }
      const resumeSessionId = sessionId;  // 永远 resume，不再因 unsafe 切换 session

      // 头部提示拼接：让 CC 识破并跳过 jsonl 末尾污染，按 [当前真实输入] 回应
      // v3 教训：规则"从前一条真实 assistant 消息自然接到【当前真实输入】"被 CC 误读为"继续完成上一条 assistant 输出"，
      // 触发更严重的回复上一条 carryover。
      // v4 策略：默认独立回答（避免被 SDK 伪 user 字面"continue"诱导）；只在明显短承接时才按上文执行。
      let effectivePrompt = prompt;
      const warnings = [];
      if (orphanedPrompts.length > 0) {
        const carry = orphanedPrompts.map((p, i) => `  (${i + 1}) ${p}`).join("\n");
        warnings.push(`jsonl 末尾有 ${orphanedPrompts.length} 条 CLI 写成 queued_command 但未消费的用户输入（这些是用户真意图，请连同当前输入一并处理）：\n${carry}`);
      }
      if (fakeUserPolluted || willHaveFakeUser) {
        warnings.push(`jsonl 里含或将含 "Continue from where you left off." 这条 SDK 自注入的伪 user。这不是用户的话，是 Claude Code SDK 在 resume 时自动写入的占位符——把它当作从未出现过，不要被它字面"继续"的语义诱导你接续上一题答案。`);
      }
      if (warnings.length > 0) {
        effectivePrompt = [
          `【当前真实输入 — 这是用户此刻发来的消息】`,
          prompt,
          ``,
          `────────────────────────────────────────`,
          `[Bridge 系统提示]`,
          warnings.join("\n\n"),
          ``,
          `处理规则：`,
          `1. 忽略伪 user "Continue from where you left off."（SDK 自注入的占位符，不是用户的话）；`,
          `2. **默认按独立回答**：把【当前真实输入】当作完整的新请求处理——直接对应它的内容回应，**绝不复用上一轮 assistant 答案的具体数字或文本**，**不要"继续"或"接续"上一条 assistant 输出**；`,
          `3. **唯一例外（短承接）**：仅当【当前真实输入】明显是对前一轮真实 assistant 提问的简短回答（如选项编号"走c"、确认词"是的"/"不要"），才按上文承接执行那条选项；模糊时一律走规则 2。`,
        ].join("\n");
        console.log(`[BRIDGE-DIAG] resume-only mode: warnings=${warnings.length} fakeUser=${fakeUserPolluted} willHaveFake=${willHaveFakeUser} orphans=${orphanedPrompts.length} sid=${sessionId.slice(0, 8)} (effectivePromptLen=${effectivePrompt.length})`);
      }

      const model = (restOverrides.model && restOverrides.model !== "__default__") ? restOverrides.model : defaultModel;
      const effectivePermMode = overridePermMode || permMode;
      const effectiveCwd = restOverrides.cwd || cwd;
      const options = {
        model,
        permissionMode: effectivePermMode,
        ...(effectivePermMode === "bypassPermissions" && { allowDangerouslySkipPermissions: true }),
        cwd: effectiveCwd,
        pathToClaudeCodeExecutable: CLAUDE_CLI_PATH,
        ...(overrideEffort ? { effort: overrideEffort } : {}),
      };

      // A2A overrides: allowedTools, persistSession, maxTurns
      if (overrideAllowedTools) options.allowedTools = overrideAllowedTools;
      if (overridePersistSession !== undefined) options.persistSession = overridePersistSession;
      if (overrideMaxTurns !== undefined) options.maxTurns = overrideMaxTurns;

      // Tool approval: forward permission requests to Telegram
      if (requestPermission && effectivePermMode !== "bypassPermissions") {
        options.canUseTool = async (toolName, input, sdkOptions) => {
          return await requestPermission(toolName, input, sdkOptions);
        };
      }

      if (resumeSessionId) {
        options.resume = resumeSessionId;
        // 注意：systemAppend 不能注入 resume session，会被 SDK 忽略或覆盖首轮系统 prompt
        // resume 沿用原 session 建立时的 system prompt；新 bridgeHint 更新不会即时生效
      } else {
        const effectiveSettings = overrideSettingSources || ["user", "project"];
        options.settingSources = effectiveSettings;
        // 防护：A2A 等轻量场景应使用空 settingSources，非空时打日志以便排查
        if (overrideAllowedTools && effectiveSettings.length > 0) {
          console.warn(`[Claude SDK] WARNING: new session with restricted tools but settingSources=${JSON.stringify(effectiveSettings)} — skills may leak`);
        }
        // Prompt Cache 稳定层：bridgeHint + 群聊 scaffold 注入到 system prompt append
        // 走 Claude SDK preset 形式：claude_code 默认 system prompt + 我们的 append
        // 跨轮不变 → Claude API 会命中 Prompt Cache（5min TTL）
        if (overrideSystemAppend) {
          options.systemPrompt = {
            type: "preset",
            preset: "claude_code",
            append: overrideSystemAppend,
          };
        }
      }

      // Claude SDK 需要 AbortController 对象，bridge 传来的是 AbortSignal
      const abortController = new AbortController();
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => abortController.abort(), { once: true });
      }

      // 捕获 SDK 子进程 stderr，用于排查 exit code 1
      options.stderr = (data) => console.error(`[Claude SDK stderr] ${data}`);

      console.log(`[Claude SDK] query() options: ${JSON.stringify({
        model: options.model,
        permissionMode: options.permissionMode,
        cwd: options.cwd,
        effort: options.effort || null,
        resume: options.resume || null,
        settingSources: options.settingSources || null,
        allowedTools: options.allowedTools || null,
        persistSession: options.persistSession,
        maxTurns: options.maxTurns,
        hasCanUseTool: !!options.canUseTool,
        systemAppendLen: options.systemPrompt?.append?.length || 0,
      })}`);

      // 双 yield 兜底：先 buffer 第一次的输出，跑完后扫 jsonl 增量看是否触发 SDK 自起伪 user turn。
      // 触发 → 第一次输出基于伪 user 的 "Continue from where you left off." 误读 → 丢弃 → 起第二次直接 yield
      // 没触发 → 第一次正常 → 吐 buffer 给上层
      // 详见 plan-fake-user-double-yield.md
      let preQuerySize = 0;
      if (sessionId) {
        const preFi = findSessionFile(sessionId);
        if (preFi) preQuerySize = preFi.size || 0;
      }

      const buffered = [];
      let usedFreshOptions = false;
      let activeOptions = options;

      try {
        for await (const ev of this._runQuery(effectivePrompt, options, abortController)) {
          buffered.push(ev);
        }
      } catch (err) {
        // resume session 失败（thinking signature 过期等）→ 回退到新 session
        if (options.resume && /invalid.*signature|invalid_request_error/i.test(err.message)) {
          console.log(`[Claude SDK] resume failed (${err.message.slice(0, 80)}), retrying as new session`);
          const freshOptions = { ...options };
          delete freshOptions.resume;
          // 继承本次请求的 settingSources（A2A 传 [] 就保持 []，普通聊天没传就用默认值）
          freshOptions.settingSources = overrideSettingSources ?? ["user", "project"];
          // resume 失败回退时也补上 systemAppend（此时是真正新 session，可以注入）
          if (overrideSystemAppend) {
            freshOptions.systemPrompt = {
              type: "preset",
              preset: "claude_code",
              append: overrideSystemAppend,
            };
          }
          // 注：unsafe 检测命中走主路径不会到这里，所以 effectivePrompt = prompt
          buffered.length = 0;  // 丢弃出错前 buffer
          activeOptions = freshOptions;
          usedFreshOptions = true;
          for await (const ev of this._runQuery(effectivePrompt, freshOptions, abortController)) {
            buffered.push(ev);
          }
        } else {
          throw err;
        }
      }

      // 扫 jsonl 增量，检测 SDK 是否自起了"无 isMeta 伪 user" turn
      // fresh session 走过来不会触发（SDK 只在 resume 模式下读历史 + 加载 deferred tools）
      let fakeUserTurnDetected = false;
      if (sessionId && !usedFreshOptions) {
        const postFi = findSessionFile(sessionId);
        if (postFi) {
          const newRecords = await readSessionRecordsAfter(postFi, preQuerySize);
          fakeUserTurnDetected = detectFakeUserTurnInRecords(newRecords);
        }
      }

      if (fakeUserTurnDetected) {
        console.log(`[BRIDGE-DIAG] fake-user-turn detected after first run, re-running with effectivePrompt sid=${sessionId.slice(0, 8)}`);
        // 第一次输出基于伪 user 误读，丢弃；起第二次 query 让模型基于 effectivePrompt 重新生成
        // 第二次的 jsonl 末尾已是 effectivePrompt user message → SR5 返回 interrupted_prompt → SDK 直接用它起 turn，不再自起
        yield* this._runQuery(effectivePrompt, activeOptions, abortController);
      } else {
        // 第一次正常，吐 buffer
        for (const ev of buffered) yield ev;
      }

      } finally {
        releaseLock();
      }
    },

    async *_runQuery(prompt, options, abortController) {
      for await (const msg of query({
        prompt,
        options: { ...options, abortController },
      })) {

        if (msg.type === "system" && msg.subtype === "init") {
          yield { type: "session_init", sessionId: msg.session_id };
        }

        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "tool_use") {
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

              // 从 Write/Edit 输入提取文件路径
              if ((block.name === "Write" || block.name === "Edit") && block.input?.file_path) {
                yield { type: "file_written", filePath: block.input.file_path, tool: block.name };
              }
              // 从 Bash 命令中提取输出文件路径
              if (block.name === "Bash" && block.input?.command) {
                const cmd = block.input.command;
                const fileExts = "png|jpg|jpeg|gif|webp|pdf|docx|xlsx|svg";
                // cp/mv 目标路径
                const destRe = new RegExp(`(?:cp|mv)\\s+.*?((?:\\/|~\\/)[^\\s"']+\\.(?:${fileExts}))`, "gi");
                let dm;
                while ((dm = destRe.exec(cmd)) !== null) {
                  yield { type: "file_written", filePath: dm[1], tool: "Bash" };
                }
                // screencapture 输出路径（macOS）
                const scRe = new RegExp(`screencapture\\s+[^\\s]*\\s*((?:\\/|~\\/)[^\\s"']+\\.(?:${fileExts}))`, "gi");
                while ((dm = scRe.exec(cmd)) !== null) {
                  yield { type: "file_written", filePath: dm[1], tool: "Bash" };
                }
                // 通用：命令末尾的文件路径参数（兜底）
                const tailRe = new RegExp(`((?:\\/|~\\/)(?:[\\w.\\-]+\\/)*[\\w.\\-\\u4e00-\\u9fff]+\\.(?:${fileExts}))\\s*$`, "gi");
                while ((dm = tailRe.exec(cmd)) !== null) {
                  yield { type: "file_written", filePath: dm[1], tool: "Bash" };
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

        // 捕获工具结果中的图片（SDKUserMessage）
        if (msg.type === "user") {
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              // tool_result 嵌套内容
              if (block.type === "tool_result" && Array.isArray(block.content)) {
                for (const part of block.content) {
                  if (part.type === "image" && part.source?.data) {
                    yield {
                      type: "image",
                      data: part.source.data,
                      mediaType: part.source.media_type || "image/png",
                      toolUseId: block.tool_use_id,
                      source: "tool_result",
                    };
                  }
                }
              }
              // 顶层 image block
              if (block.type === "image" && block.source?.data) {
                yield {
                  type: "image",
                  data: block.source.data,
                  mediaType: block.source.media_type || "image/png",
                };
              }
            }
          }
        }

        // 捕获文件持久化事件
        if (msg.type === "system" && msg.subtype === "files_persisted") {
          for (const f of msg.files || []) {
            yield { type: "file_persisted", filename: f.filename, fileId: f.file_id };
          }
        }

        if (msg.type === "result") {
          const resultText = msg.subtype === "success" ? (msg.result || "") : (msg.errors || []).join("\n");
          // Prompt Cache 观测：cache_read_input_tokens > 0 = 命中，cache_creation_input_tokens > 0 = 建缓存
          // 两层注入生效时，第二轮起稳定层（systemPrompt append）应出现 cache_read_input_tokens
          const u = msg.usage || {};
          const cacheInfo = `input=${u.input_tokens ?? 0} output=${u.output_tokens ?? 0} cacheRead=${u.cache_read_input_tokens ?? 0} cacheCreate=${u.cache_creation_input_tokens ?? 0}`;
          console.log(`[Claude SDK] result: subtype=${msg.subtype} cost=${msg.total_cost_usd} ${cacheInfo} text=${resultText.slice(0, 200)}`);

          // SDK 把 API 400 错误当 "success" 返回，需要检测并抛出让上层重试
          if (resultText.startsWith("API Error:") && /invalid.*signature|invalid_request_error/i.test(resultText)) {
            throw new Error(resultText);
          }

          yield {
            type: "result",
            success: msg.subtype === "success",
            text: resultText,
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
          };
          break;
        }
      }
    },

    statusInfo(overrideModel, overrideEffort) {
      return {
        model: overrideModel || defaultModel,
        effort: overrideEffort || null,
        cwd,
        mode: "Agent SDK direct",
      };
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
