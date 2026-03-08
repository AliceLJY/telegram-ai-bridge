import { runCommandProvider } from "./command.js";

export async function runGitProvider(args = {}) {
  const gitArgs = Array.isArray(args.args) ? args.args : [];
  return await runCommandProvider({
    cmd: ["git", ...gitArgs],
    cwd: args.cwd,
  });
}
