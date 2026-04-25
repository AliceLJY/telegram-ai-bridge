export const A2A_TOOL_MODES = ["read-only", "full"];

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];
const FULL_TOOLS = [...READ_ONLY_TOOLS, "Bash", "WebFetch", "WebSearch"];

export function normalizeA2AToolMode(value) {
  return A2A_TOOL_MODES.includes(value) ? value : "read-only";
}

export function createA2AClaudeOverrides(options = {}) {
  const toolMode = normalizeA2AToolMode(options.toolMode);

  return {
    permissionMode: "dontAsk",
    allowedTools: toolMode === "full" ? FULL_TOOLS : READ_ONLY_TOOLS,
    persistSession: true,
    maxTurns: 1,
    settingSources: [],
  };
}
