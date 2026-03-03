// 实时进度显示模块
// 支持统一适配器事件格式（type: progress/text）

// 工具图标映射（Claude 专用，Codex 用通用图标）
const TOOL_ICONS = {
  Read: "📖",
  Write: "✍️",
  Edit: "✏️",
  Bash: "💻",
  Glob: "🔍",
  Grep: "🔎",
  WebFetch: "🌐",
  WebSearch: "🔍",
  Agent: "🤖",
  NotebookEdit: "📓",
  TodoWrite: "📝",
  TaskCreate: "📋",
  TaskUpdate: "📋",
  TaskList: "📋",
  TaskGet: "📋",
  AskUserQuestion: "❓",
};

const SILENT_TOOLS = new Set([
  "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet",
]);

const MAX_ENTRIES = 15;
const EDIT_THROTTLE_MS = 2000;

export function createProgressTracker(ctx, chatId, verboseLevel = 1, backendLabel = "CC") {
  let progressMsgId = null;
  let typingInterval = null;
  let entries = [];
  let lastEditTime = 0;
  let editTimer = null;
  let finished = false;

  const headerText = `⏳ ${backendLabel} 正在处理...`;

  async function start() {
    try {
      const msg = await ctx.api.sendMessage(chatId, headerText);
      progressMsgId = msg.message_id;
    } catch {
      // 发送失败不影响主流程
    }

    // Typing 心跳（每 4 秒发一次，Telegram typing 持续 5 秒）
    typingInterval = setInterval(() => {
      ctx.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);
    // 立刻发一次
    ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  }

  // 处理适配器统一事件
  function processEvent(event) {
    if (finished || verboseLevel === 0) return;

    if (event.type === "progress") {
      const toolName = event.toolName || "action";
      if (SILENT_TOOLS.has(toolName)) return;
      const icon = TOOL_ICONS[toolName] || "🔧";

      if (verboseLevel >= 2 && event.input) {
        const input = typeof event.input === "object"
          ? (event.input.command || event.input.file_path || event.input.description || event.input.pattern || event.input.query || "").slice(0, 60)
          : (event.detail || "").slice(0, 60);
        entries.push(`${icon} ${toolName}${input ? ": " + input : ""}`);
      } else if (verboseLevel >= 2 && event.detail) {
        entries.push(`${icon} ${toolName}: ${event.detail.slice(0, 60)}`);
      } else {
        entries.push(`${icon} ${toolName}`);
      }
    } else if (event.type === "text" && event.text && verboseLevel >= 2) {
      const snippet = event.text.slice(0, 80).replace(/\n/g, " ");
      if (snippet.trim()) {
        entries.push(`💭 ${snippet}${event.text.length > 80 ? "..." : ""}`);
      }
    }

    // 保留最近 MAX_ENTRIES 条
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(-MAX_ENTRIES);
    }

    scheduleEdit();
  }

  function scheduleEdit() {
    if (!progressMsgId || finished) return;
    const now = Date.now();
    const timeSinceLastEdit = now - lastEditTime;

    if (timeSinceLastEdit >= EDIT_THROTTLE_MS) {
      doEdit();
    } else if (!editTimer) {
      editTimer = setTimeout(() => {
        editTimer = null;
        if (!finished) doEdit();
      }, EDIT_THROTTLE_MS - timeSinceLastEdit);
    }
  }

  function doEdit() {
    if (!progressMsgId || finished) return;
    lastEditTime = Date.now();

    const text = entries.length > 0
      ? `${headerText}\n\n${entries.join("\n")}`
      : headerText;

    ctx.api.editMessageText(chatId, progressMsgId, text).catch(() => {});
  }

  async function finish() {
    finished = true;

    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
    if (progressMsgId) {
      await ctx.api.deleteMessage(chatId, progressMsgId).catch(() => {});
      progressMsgId = null;
    }
  }

  return { start, processEvent, finish };
}
