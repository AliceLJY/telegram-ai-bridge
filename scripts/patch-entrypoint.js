// CC 2.1.131 SDK 把 bridge 写的 jsonl 标成 entrypoint:"sdk-cli"，
// 终端 /resume 只显示 entrypoint:"cli" 的会话，所以 bridge sessions 被吞。
// 这里在 bridge 启动时和周期性地扫一遍 ~/.claude/projects/，
// 把 "sdk-cli" 改回 "cli"。跳过 30 秒内被写过的文件，避免跟 SDK 子进程打架。
//
// 2026-05-29 治理：bridge.js 已加 owner guard 限制只有一个 bridge 跑 patcher。
// 周期扫描加 mtime 时间窗 5min（启动时仍全扫补历史），避免 readFileSync 5000+
// 远古 jsonl 全文判 includes 浪费 IO。

import { readdirSync, statSync, readFileSync, writeFileSync, utimesSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const SKIP_RECENT_MS = 30 * 1000;
const PATCH_WINDOW_MS = 5 * 60 * 1000; // 周期扫只看 5min 内修改的 jsonl
const TARGET = '"entrypoint":"sdk-cli"';
const REPLACEMENT = '"entrypoint":"cli"';

// fullScan=true: 启动期全扫补历史；false: 周期扫只看 mtime > now - PATCH_WINDOW_MS
export function patchEntrypointInProjects({ fullScan = false } = {}) {
  const now = Date.now();
  let fixed = 0;
  let dirs;
  try {
    dirs = readdirSync(PROJECTS_DIR);
  } catch {
    return 0;
  }

  for (const dir of dirs) {
    const dirPath = join(PROJECTS_DIR, dir);
    let files;
    try {
      if (!statSync(dirPath).isDirectory()) continue;
      files = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(dirPath, file);
      try {
        const stat = statSync(filePath);
        if (now - stat.mtimeMs < SKIP_RECENT_MS) continue;
        // 周期扫跳过远古 jsonl（早已 patch 过的，readFileSync 全文也是浪费）
        if (!fullScan && now - stat.mtimeMs > PATCH_WINDOW_MS) continue;
        const content = readFileSync(filePath, "utf-8");
        if (!content.includes(TARGET)) continue;
        writeFileSync(filePath, content.split(TARGET).join(REPLACEMENT), "utf-8");
        // 保留原 mtime —— TG /sessions 按 jsonl mtime 排序，写入会重置 mtime 导致排序乱
        utimesSync(filePath, stat.atime, stat.mtime);
        fixed++;
      } catch {
        // skip unreadable files
      }
    }
  }
  return fixed;
}

export function startEntrypointPatcher(intervalMs = SKIP_RECENT_MS) {
  const initialFixed = patchEntrypointInProjects({ fullScan: true });
  if (initialFixed > 0) {
    console.log(`[entrypoint-patch] boot fixed ${initialFixed} jsonl(s)`);
  }
  return setInterval(() => {
    const n = patchEntrypointInProjects({ fullScan: false });
    if (n > 0) {
      console.log(`[entrypoint-patch] periodic fixed ${n} jsonl(s)`);
    }
  }, intervalMs);
}
