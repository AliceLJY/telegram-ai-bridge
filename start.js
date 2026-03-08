#!/usr/bin/env bun

import {
  resolveCliArgs,
  loadRuntimeConfig,
  applyRuntimeEnv,
  summarizeRuntime,
  getBackendProfile,
  runSetupWizard,
  inspectRuntime,
  bootstrapWorkspace,
} from "./config.js";

function printHelp() {
  console.log(`Telegram AI Bridge CLI

Usage:
  bun run start --backend claude
  npm start -- --backend claude
  bun run bootstrap --backend claude
  bun run check --backend claude
  bun run setup

Commands:
  start         Start one backend instance
  bootstrap     Create a starter config.json and files/ directory
  check         Validate config and local prerequisites
  setup         Create or update config.json interactively
  config        Print the resolved runtime config (secrets redacted)

Options:
  --backend, -b   claude | codex | gemini (experimental)
  --config, -c    Path to config.json
  --force, -f     Overwrite an existing config file during bootstrap
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

  if (cli.command === "bootstrap") {
    const result = bootstrapWorkspace({
      backend: cli.backend,
      configPath: cli.configPath,
      force: cli.force,
    });
    if (result.created) {
      const action = result.overwritten ? "Rewrote" : "Created";
      console.log(`${action} starter config at ${result.configPath}`);
      console.log(`Prepared files directory at ${result.filesDir}`);
      console.log(`Next: edit ${result.configPath}, then run bun run check --backend ${result.backend}`);
      return;
    }

    console.log(`Config already exists at ${result.configPath}`);
    console.log("Pass --force to overwrite it, or run bun run setup to edit it interactively.");
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

  if (cli.command === "check") {
    const report = inspectRuntime(runtime);
    console.log(`[check] backend=${report.backend} source=${report.source}`);
    console.log(`[check] cwd=${report.cwd}`);
    console.log(`[check] sessions_db=${report.sessionsDb}`);
    console.log(`[check] tasks_db=${report.tasksDb}`);
    for (const warning of report.warnings) {
      console.warn(`[check] warning ${warning.path}: ${warning.message}`);
    }
    if (report.errors.length) {
      console.error(formatCheckErrors(report.errors));
      process.exit(1);
    }
    console.log("[check] ok");
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

function formatCheckErrors(errors) {
  return [
    "[check] failed",
    ...errors.map((issue, index) => `${index + 1}. ${issue.path}: ${issue.message}`),
  ].join("\n");
}
