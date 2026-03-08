#!/usr/bin/env bun

import { createInterface } from "readline";
import { createBackend } from "../adapters/interface.js";
import { encodeMessage, parseMessage } from "./protocol.js";
import { runCommandProvider } from "./providers/command.js";
import { runFilesystemProvider } from "./providers/filesystem.js";
import { runGitProvider } from "./providers/git.js";

const pendingApprovals = new Map();

function send(message) {
  process.stdout.write(encodeMessage(message));
}

function getProvider(capability) {
  if (capability === "command") return runCommandProvider;
  if (capability === "filesystem") return runFilesystemProvider;
  if (capability === "git") return runGitProvider;
  return null;
}

async function runCapabilityTask(message) {
  const provider = getProvider(message.capability);
  if (!provider) {
    throw new Error(`unsupported capability: ${message.capability}`);
  }
  const result = await provider(message.args || {});
  send({ type: "result", ok: true, data: result });
  send({ type: "done" });
}

async function runStreamQueryTask(message) {
  const backend = createBackend(message.backendName, { cwd: message.cwd || process.cwd() });
  const overrides = { ...(message.overrides || {}) };

  overrides.requestPermission = async (toolName, input, sdkOptions) => {
    const requestId = `perm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    send({
      type: "approval_request",
      requestId,
      toolName,
      input,
      sdkOptions,
    });

    return await new Promise((resolve) => {
      pendingApprovals.set(requestId, resolve);
    });
  };

  for await (const event of backend.streamQuery(
    message.prompt,
    message.sessionId || null,
    undefined,
    overrides,
  )) {
    send({ type: "event", event });
  }

  send({ type: "done" });
}

async function handleMessage(message) {
  if (message.type === "approval_response") {
    const resolver = pendingApprovals.get(message.requestId);
    if (!resolver) return;
    pendingApprovals.delete(message.requestId);
    resolver(message.response || { behavior: "deny", message: "missing approval response" });
    return;
  }

  if (message.type !== "run_task") {
    throw new Error(`unsupported message type: ${message.type}`);
  }

  if (message.capability && message.capability !== "ai_turn") {
    await runCapabilityTask(message);
    return;
  }

  await runStreamQueryTask(message);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
send({ type: "ready" });

for await (const line of rl) {
  if (!String(line || "").trim()) continue;
  try {
    await handleMessage(parseMessage(line));
  } catch (error) {
    send({
      type: "error",
      message: error.message,
    });
    send({ type: "done" });
  }
}
