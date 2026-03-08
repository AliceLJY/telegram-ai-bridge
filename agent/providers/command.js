import { spawn } from "node:child_process";

export async function runCommandProvider(args = {}) {
  const cmd = Array.isArray(args.cmd) ? args.cmd : [];
  const cwd = args.cwd || process.cwd();

  if (!cmd.length) {
    throw new Error("command provider requires a non-empty cmd array");
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
