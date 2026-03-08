import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";

export function runFilesystemProvider(args = {}) {
  const action = args.action || "read";
  const target = resolve(args.path || "");

  if (!target) {
    throw new Error("filesystem provider requires path");
  }

  if (action === "read") {
    return { ok: true, path: target, content: readFileSync(target, "utf8") };
  }

  if (action === "write") {
    writeFileSync(target, String(args.content || ""), "utf8");
    return { ok: true, path: target };
  }

  if (action === "list") {
    return {
      ok: true,
      path: target,
      entries: readdirSync(target).map((name) => {
        const fullPath = resolve(target, name);
        let kind = "unknown";
        try {
          kind = statSync(fullPath).isDirectory() ? "dir" : "file";
        } catch {
          kind = "unknown";
        }
        return { name, kind };
      }),
    };
  }

  throw new Error(`unsupported filesystem action: ${action}`);
}
