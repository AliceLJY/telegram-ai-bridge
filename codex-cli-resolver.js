import { spawnSync } from "child_process";
import { accessSync, constants } from "fs";
import { delimiter, join, sep } from "path";

const DEFAULT_VALIDATE_TIMEOUT_MS = 5000;
const DEFAULT_ENV_KEYS = [
  "TELEGRAM_AI_BRIDGE_CODEX_BIN",
  "CODEX_CLI_PATH",
  "CODEX_BIN",
];

export function defaultKnownCodexPaths(platform = process.platform) {
  return platform === "darwin"
    ? [
        "/Applications/ChatGPT.app/Contents/Resources/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
      ]
    : [];
}

const DEFAULT_KNOWN_PATHS = defaultKnownCodexPaths();

function codexBinaryName() {
  return process.platform === "win32" ? "codex.exe" : "codex";
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function pathCandidates(env) {
  return String(env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, codexBinaryName()));
}

function isNodeModulesBin(candidate) {
  const parts = String(candidate || "").split(sep);
  return parts.includes("node_modules") && parts.includes(".bin");
}

function isExecutable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function validateCodexExecutable(candidate, options = {}) {
  const env = options.env || process.env;
  const timeoutMs = options.validateTimeoutMs || DEFAULT_VALIDATE_TIMEOUT_MS;
  if (!candidate || !isExecutable(candidate)) return null;

  const result = spawnSync(candidate, ["--version"], {
    env,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (result.status !== 0) return null;

  const version = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return /codex/i.test(version) ? version : null;
}

export function resolveCodexCommand(options = {}) {
  const env = options.env || process.env;
  const timeoutMs = options.validateTimeoutMs || DEFAULT_VALIDATE_TIMEOUT_MS;
  const knownPaths = options.knownPaths || DEFAULT_KNOWN_PATHS;
  const envKeys = options.envKeys || DEFAULT_ENV_KEYS;

  for (const key of envKeys) {
    const explicitPath = String(env[key] || "").trim();
    if (!explicitPath) continue;
    const version = validateCodexExecutable(explicitPath, { env, validateTimeoutMs: timeoutMs });
    if (version) return { path: explicitPath, source: key, version };
    throw new Error(`${key} points to an invalid codex executable: ${explicitPath}`);
  }

  for (const candidate of unique(knownPaths)) {
    const version = validateCodexExecutable(candidate, { env, validateTimeoutMs: timeoutMs });
    if (version) return { path: candidate, source: "known-path", version };
  }

  for (const candidate of unique(pathCandidates(env)).filter((item) => !isNodeModulesBin(item))) {
    const version = validateCodexExecutable(candidate, { env, validateTimeoutMs: timeoutMs });
    if (version) return { path: candidate, source: "PATH", version };
  }

  throw new Error("No valid codex executable found. Set TELEGRAM_AI_BRIDGE_CODEX_BIN to a working Codex CLI path.");
}
