#!/usr/bin/env bun

import {
  resolveCliArgs,
  loadRuntimeConfig,
  applyRuntimeEnv,
  summarizeRuntime,
  getBackendProfile,
  runSetupWizard,
} from "./config.js";

function printHelp() {
  console.log(`Telegram AI Bridge CLI

Usage:
  bun run start --backend claude
  npm start -- --backend claude
  bun run setup

Commands:
  start         Start one backend instance
  setup         Create or update config.json interactively
  config        Print the resolved runtime config (secrets redacted)

Options:
  --backend, -b   claude | codex | gemini (experimental)
  --config, -c    Path to config.json
  --help, -h      Show this help
`);
}

async function main() {
  const cli = resolveCliArgs(process.argv);

  if (cli.help || cli.command === "help") {
    printHelp();
    return;
  }

  if (cli.command === "setup") {
    const result = await runSetupWizard({
      backend: cli.backendSpecified ? cli.backend : null,
      configPath: cli.configPath,
    });
    console.log(`\nSaved config to ${result.configPath}`);
    return;
  }

  const runtime = loadRuntimeConfig({
    backend: cli.backend,
    configPath: cli.configPath,
  });
  const profile = getBackendProfile(runtime.backend);

  if (cli.command === "config") {
    console.log(JSON.stringify(summarizeRuntime(runtime), null, 2));
    return;
  }

  if (cli.command !== "start") {
    throw new Error(`Unknown command: ${cli.command}`);
  }

  applyRuntimeEnv(runtime.env);
  console.log(`[start] backend=${runtime.backend} source=${runtime.source}`);
  if (profile.maturity === "experimental") {
    console.log(`[start] note=${profile.summary}`);
  }
  await import("./bridge.js");
}

main().catch((error) => {
  console.error(`[start] ${error.message}`);
  process.exit(1);
});
