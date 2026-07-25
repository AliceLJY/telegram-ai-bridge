import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function writeMessage(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function rejectUnsupportedServerRequest(child, message) {
  if (message.id == null || !message.method) return false;
  writeMessage(child, {
    id: message.id,
    error: {
      code: -32601,
      message: `${message.method} is not supported by the Telegram bridge`,
    },
  });
  return true;
}

function normalizeItem(item = {}) {
  const typeMap = {
    agentMessage: "agent_message",
    commandExecution: "command_execution",
    fileChange: "file_change",
    mcpToolCall: "mcp_tool_call",
    webSearch: "web_search",
    todoList: "todo_list",
  };
  return { ...item, type: typeMap[item.type] || item.type };
}

export function mapAppServerNotification(message) {
  const { method, params = {} } = message;

  if (method === "thread/started") {
    return {
      type: "thread.started",
      thread_id: params.thread?.id,
    };
  }
  if (method === "item/completed") {
    if (params.item?.type === "userMessage") return null;
    return {
      type: "item.completed",
      item: normalizeItem(params.item),
    };
  }
  if (method === "turn/completed") {
    if (params.turn?.status === "failed") {
      return {
        type: "turn.failed",
        error: params.turn.error,
      };
    }
    return { type: "turn.completed" };
  }
  if (method === "error") {
    return {
      type: "error",
      message: params.error?.message || params.message || "Codex app-server error",
    };
  }
  return null;
}

export async function* streamAppServerEvents({
  codexPath,
  prompt,
  sessionId,
  cwd,
  model,
  effort,
  serviceTier,
  abortSignal,
}) {
  const child = spawn(codexPath, ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  let stderr = "";
  let spawnError = null;
  let nextId = 1;

  child.on("error", error => {
    spawnError = error;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => {
    stderr = `${stderr}${chunk}`.slice(-8000);
  });

  const abort = () => child.kill("SIGTERM");
  if (abortSignal) {
    if (abortSignal.aborted) abort();
    else abortSignal.addEventListener("abort", abort, { once: true });
  }

  async function request(method, params) {
    const id = nextId++;
    writeMessage(child, { id, method, params });
    while (true) {
      const { value, done } = await iterator.next();
      if (done) {
        throw new Error(spawnError?.message || stderr.trim() || `Codex app-server exited before ${method} responded`);
      }
      const message = JSON.parse(value);
      if (rejectUnsupportedServerRequest(child, message)) continue;
      if (message.id !== id) continue;
      if (message.error) throw new Error(message.error.message || JSON.stringify(message.error));
      return message.result;
    }
  }

  try {
    await request("initialize", {
      clientInfo: {
        name: "telegram-ai-bridge",
        title: "Telegram AI Bridge",
        version: "5.0.1",
      },
      capabilities: {},
    });
    writeMessage(child, { method: "initialized", params: {} });

    const threadParams = { cwd, approvalPolicy: "never" };
    if (model) threadParams.model = model;
    if (serviceTier) threadParams.serviceTier = serviceTier;

    const threadResult = sessionId
      ? await request("thread/resume", { threadId: sessionId, ...threadParams })
      : await request("thread/start", { ...threadParams, threadSource: "telegram_ai_bridge" });
    const thread = threadResult.thread;
    if (!thread?.id) throw new Error("Codex app-server did not return a thread id");

    yield {
      event: { type: "thread.started", thread_id: thread.id },
      thread,
    };

    const turnParams = {
      threadId: thread.id,
      input: [{ type: "text", text: prompt }],
    };
    if (model) turnParams.model = model;
    if (effort) turnParams.effort = effort;
    if (serviceTier) turnParams.serviceTier = serviceTier;
    await request("turn/start", turnParams);

    for await (const line of iterator) {
      const message = JSON.parse(line);
      if (rejectUnsupportedServerRequest(child, message)) continue;
      const event = mapAppServerNotification(message);
      if (!event || event.type === "thread.started") continue;
      yield { event, thread };
      if (event.type === "turn.completed" || event.type === "turn.failed") return;
    }

    throw new Error(stderr.trim() || "Codex app-server exited before the turn completed");
  } finally {
    if (abortSignal) abortSignal.removeEventListener("abort", abort);
    lines.close();
    if (!child.killed) child.kill("SIGTERM");
  }
}
