import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname, join, isAbsolute } from "path";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";

const REPO_DIR = import.meta.dir;
const DEFAULT_CONFIG_PATH = join(REPO_DIR, "config.json");
const AVAILABLE_BACKENDS = ["claude", "codex", "gemini"];
const BACKEND_PROFILES = {
  claude: {
    label: "Claude",
    maturity: "recommended",
    summary: "Recommended primary backend.",
  },
  codex: {
    label: "Codex",
    maturity: "recommended",
    summary: "Recommended primary backend.",
  },
  gemini: {
    label: "Gemini",
    maturity: "experimental",
    summary: "Experimental compatibility backend. Claude/Codex are the primary paths.",
  },
};

export function createDefaultConfig() {
  return {
    shared: {
      ownerTelegramId: "",
      cwd: process.env.HOME || REPO_DIR,
      httpProxy: "",
      defaultVerboseLevel: 1,
      executor: "direct",
      tasksDb: "",
      enableGroupSharedContext: true,
      groupContextMaxMessages: 30,
      groupContextMaxTokens: 3000,
      groupContextTtlMs: 1200000,
      triggerDedupTtlMs: 300000,
      sessionTimeoutMs: 900000,
    },
    backends: {
      claude: {
        enabled: true,
        telegramBotToken: "",
        sessionsDb: "sessions.db",
        model: "claude-sonnet-4-6",
        permissionMode: "default",
      },
      codex: {
        enabled: false,
        telegramBotToken: "",
        sessionsDb: "sessions-codex.db",
        model: "",
      },
      gemini: {
        enabled: false,
        telegramBotToken: "",
        sessionsDb: "sessions-gemini.db",
        model: "gemini-2.5-pro",
        oauthClientId: "",
        oauthClientSecret: "",
        googleCloudProject: "",
      },
    },
  };
}

function mergeConfig(base, patch) {
  const result = structuredClone(base);
  if (!patch || typeof patch !== "object") return result;

  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object") {
      result[key] = mergeConfig(result[key], value);
      continue;
    }
    result[key] = value;
  }

  return result;
}

function normalizeBackendName(name) {
  return String(name || "claude").toLowerCase();
}

export function getBackendProfile(name) {
  return BACKEND_PROFILES[normalizeBackendName(name)] || {
    label: String(name || "unknown"),
    maturity: "unknown",
    summary: "",
  };
}

function resolvePathMaybe(baseDir, targetPath) {
  if (!targetPath) return targetPath;
  if (isAbsolute(targetPath)) return targetPath;
  return resolve(baseDir, targetPath);
}

function parseJsonConfig(configPath) {
  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return mergeConfig(createDefaultConfig(), parsed);
}

function parseEnvFile(envPath) {
  const values = {};
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function pickLegacyEnvFiles(repoDir, backend) {
  if (backend === "claude") {
    return [join(repoDir, ".env.claude"), join(repoDir, ".env")];
  }
  return [join(repoDir, `.env.${backend}`), join(repoDir, ".env")];
}

function loadLegacyEnv(repoDir, backend) {
  const files = pickLegacyEnvFiles(repoDir, backend);
  const found = files.filter((file) => existsSync(file));
  if (!found.length) {
    throw new Error(
      `No config source found. Create config.json with \`bun run setup\` or add ${files.map((file) => file.split("/").pop()).join(" / ")}.`,
    );
  }

  const merged = {};
  for (const file of [...found].reverse()) {
    Object.assign(merged, parseEnvFile(file));
  }

  return {
    source: found.map((file) => file.split("/").pop()).join(" + "),
    env: {
      ...merged,
      DEFAULT_BACKEND: backend,
      ENABLED_BACKENDS: backend,
    },
  };
}

function buildEnvFromConfig(config, backend, configPath) {
  const selectedBackend = normalizeBackendName(backend);
  if (!AVAILABLE_BACKENDS.includes(selectedBackend)) {
    throw new Error(`Unsupported backend: ${selectedBackend}`);
  }

  const backendConfig = config.backends?.[selectedBackend];
  if (!backendConfig) {
    throw new Error(`Missing backends.${selectedBackend} in ${configPath}`);
  }
  if (backendConfig.enabled === false) {
    throw new Error(`Backend \"${selectedBackend}\" is disabled in ${configPath}`);
  }

  const baseDir = dirname(configPath);
  const shared = config.shared || {};
  const env = {
    OWNER_TELEGRAM_ID: shared.ownerTelegramId != null ? String(shared.ownerTelegramId) : "",
    TELEGRAM_BOT_TOKEN: backendConfig.telegramBotToken || "",
    HTTPS_PROXY: shared.httpProxy || "",
    CC_CWD: resolvePathMaybe(baseDir, shared.cwd || process.env.HOME || REPO_DIR),
    DEFAULT_VERBOSE_LEVEL: String(shared.defaultVerboseLevel ?? 1),
    BRIDGE_EXECUTOR: String(shared.executor || "direct"),
    DEFAULT_BACKEND: selectedBackend,
    ENABLED_BACKENDS: selectedBackend,
    ENABLE_GROUP_SHARED_CONTEXT: String(shared.enableGroupSharedContext ?? true),
    GROUP_CONTEXT_MAX_MESSAGES: String(shared.groupContextMaxMessages ?? 30),
    GROUP_CONTEXT_MAX_TOKENS: String(shared.groupContextMaxTokens ?? 3000),
    GROUP_CONTEXT_TTL_MS: String(shared.groupContextTtlMs ?? 1200000),
    TRIGGER_DEDUP_TTL_MS: String(shared.triggerDedupTtlMs ?? 300000),
    SESSION_TIMEOUT_MS: String(shared.sessionTimeoutMs ?? 900000),
    SESSIONS_DB: resolvePathMaybe(baseDir, backendConfig.sessionsDb || `${selectedBackend}.db`),
    TASKS_DB: resolvePathMaybe(baseDir, shared.tasksDb || `tasks-${selectedBackend}.db`),
  };

  if (selectedBackend === "claude") {
    env.CC_MODEL = backendConfig.model || "claude-sonnet-4-6";
    env.CC_PERMISSION_MODE = backendConfig.permissionMode || "default";
  }

  if (selectedBackend === "codex") {
    env.CODEX_MODEL = backendConfig.model || "";
  }

  if (selectedBackend === "gemini") {
    env.GEMINI_MODEL = backendConfig.model || "gemini-2.5-pro";
    env.GEMINI_OAUTH_CLIENT_ID = backendConfig.oauthClientId || "";
    env.GEMINI_OAUTH_CLIENT_SECRET = backendConfig.oauthClientSecret || "";
    env.GOOGLE_CLOUD_PROJECT = backendConfig.googleCloudProject || "";
  }

  return env;
}

export function resolveCliArgs(argv) {
  const args = argv.slice(2);
  let command = "start";
  let backend = "claude";
  let backendSpecified = false;
  let configPath = process.env.BRIDGE_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  let help = false;

  if (args[0] && !args[0].startsWith("-")) {
    command = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--backend" || arg === "-b") {
      backend = normalizeBackendName(args[index + 1]);
      backendSpecified = true;
      index += 1;
      continue;
    }
    if (arg === "--config" || arg === "-c") {
      configPath = resolve(REPO_DIR, args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  return {
    command,
    backend,
    backendSpecified,
    configPath: resolve(configPath),
    help,
  };
}

export function loadRuntimeConfig(options = {}) {
  const backend = normalizeBackendName(options.backend);
  const configPath = options.configPath ? resolve(options.configPath) : DEFAULT_CONFIG_PATH;

  if (existsSync(configPath)) {
    const config = parseJsonConfig(configPath);
    return {
      backend,
      configPath,
      source: configPath.split("/").pop(),
      env: buildEnvFromConfig(config, backend, configPath),
      config,
    };
  }

  const legacy = loadLegacyEnv(REPO_DIR, backend);
  return {
    backend,
    configPath,
    source: legacy.source,
    env: legacy.env,
    config: null,
  };
}

export function applyRuntimeEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] == null && value != null) {
      process.env[key] = String(value);
    }
  }
}

function redactValue(key, value) {
  if (!value) return value;
  const secretLike = /(TOKEN|SECRET|PASSWORD)/i.test(key);
  if (!secretLike) return value;
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function summarizeRuntime(runtime) {
  const profile = getBackendProfile(runtime.backend);
  return {
    source: runtime.source,
    backend: runtime.backend,
    backendProfile: {
      label: profile.label,
      maturity: profile.maturity,
      summary: profile.summary,
    },
    configPath: runtime.configPath,
    env: Object.fromEntries(
      Object.entries(runtime.env).map(([key, value]) => [key, redactValue(key, value)]),
    ),
  };
}

function inferEnabled(config, backend) {
  const backendConfig = config.backends?.[backend];
  if (!backendConfig) return false;
  return Boolean(backendConfig.enabled || backendConfig.telegramBotToken);
}

async function askText(rl, label, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const value = (await rl.question(`${label}${suffix}: `)).trim();
  return value || defaultValue;
}

async function askBoolean(rl, label, defaultValue) {
  const suffix = defaultValue ? " [Y/n]" : " [y/N]";
  while (true) {
    const value = (await rl.question(`${label}${suffix}: `)).trim().toLowerCase();
    if (!value) return defaultValue;
    if (["y", "yes"].includes(value)) return true;
    if (["n", "no"].includes(value)) return false;
  }
}

export async function runSetupWizard(options = {}) {
  const configPath = options.configPath ? resolve(options.configPath) : DEFAULT_CONFIG_PATH;
  const backendOnly = options.backend ? normalizeBackendName(options.backend) : null;
  const existing = existsSync(configPath) ? parseJsonConfig(configPath) : createDefaultConfig();
  const config = mergeConfig(createDefaultConfig(), existing);
  const rl = createInterface({ input, output });

  try {
    console.log("Telegram AI Bridge setup wizard\n");
    console.log(`Config file: ${configPath}`);
    console.log("Press Enter to keep the current value.\n");

    config.shared.ownerTelegramId = await askText(
      rl,
      "Owner Telegram user ID",
      String(config.shared.ownerTelegramId || ""),
    );
    config.shared.cwd = await askText(rl, "Working directory", config.shared.cwd || process.env.HOME || REPO_DIR);
    config.shared.httpProxy = await askText(rl, "HTTPS proxy (optional)", config.shared.httpProxy || "");
    config.shared.defaultVerboseLevel = Number(
      await askText(rl, "Default verbose level", String(config.shared.defaultVerboseLevel ?? 1)),
    );
    config.shared.executor = await askText(
      rl,
      "Executor mode (direct/local-agent)",
      config.shared.executor || "direct",
    );
    config.shared.tasksDb = await askText(
      rl,
      "Tasks SQLite path",
      config.shared.tasksDb || "tasks.db",
    );

    const targets = backendOnly ? [backendOnly] : AVAILABLE_BACKENDS;
    for (const backend of targets) {
      const profile = getBackendProfile(backend);
      console.log(`\n[${backend}]`);
      if (profile.summary) {
        console.log(`${profile.label}: ${profile.summary}`);
      }
      const current = config.backends[backend] || {};
      const enabledDefault = inferEnabled(config, backend);
      const enableLabel = profile.maturity === "experimental"
        ? `Enable ${backend} bot (experimental compatibility)`
        : `Enable ${backend} bot`;
      current.enabled = await askBoolean(rl, enableLabel, enabledDefault);
      config.backends[backend] = current;

      if (!current.enabled) continue;

      current.telegramBotToken = await askText(rl, `${backend} Telegram bot token`, current.telegramBotToken || "");
      current.sessionsDb = await askText(
        rl,
        `${backend} SQLite path`,
        current.sessionsDb || `${backend === "claude" ? "sessions" : `sessions-${backend}`}.db`,
      );

      if (backend === "claude") {
        current.model = await askText(rl, "Claude model", current.model || "claude-sonnet-4-6");
        current.permissionMode = await askText(rl, "Claude permission mode", current.permissionMode || "default");
      }

      if (backend === "codex") {
        current.model = await askText(rl, "Codex model (optional)", current.model || "");
      }

      if (backend === "gemini") {
        console.log("Gemini stays available, but this repo now treats it as a compatibility backend instead of a primary path.");
        current.model = await askText(rl, "Gemini model", current.model || "gemini-2.5-pro");
        current.oauthClientId = await askText(rl, "Gemini OAuth client ID", current.oauthClientId || "");
        current.oauthClientSecret = await askText(rl, "Gemini OAuth client secret", current.oauthClientSecret || "");
        current.googleCloudProject = await askText(rl, "Google Cloud project (optional)", current.googleCloudProject || "");
      }
    }
  } finally {
    rl.close();
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { configPath, config };
}
