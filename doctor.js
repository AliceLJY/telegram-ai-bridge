// 健康检查模块（借鉴 cc-connect DoctorChecker）
// /doctor 命令：全面诊断 bridge 运行状态

import { existsSync } from "fs";
import { getSharedContextStatus } from "./shared-context.js";
import { checkRedisHealth } from "./shared-context/redis-health.js";

export async function runHealthCheck(ctx) {
  const {
    adapters = {},
    activeBackends = [],
    sessions = null,
    cronManager = null,
    rateLimiter = null,
    idleMonitor = null,
    dirManager = null,
    a2aBus = null,
    sharedContextConfig = null,
    cwd = "",
    chatId = 0,
  } = ctx;

  const lines = ["🩺 *Bridge Health Check*\n"];

  // 1. Backend 连通性
  for (const name of activeBackends) {
    const adapter = adapters[name];
    if (adapter) {
      try {
        const info = adapter.statusInfo?.();
        lines.push(`✅ ${adapter.label || name}: ready (${info?.model || "default"})`);
      } catch (e) {
        lines.push(`❌ ${adapter.label || name}: ${e.message}`);
      }
    } else {
      lines.push(`❌ ${name}: adapter not loaded`);
    }
  }

  // 2. 工作目录
  if (cwd && existsSync(cwd)) {
    lines.push(`✅ 工作目录: ${cwd}`);
  } else {
    lines.push(`❌ 工作目录: ${cwd || "(未设置)"} ${cwd ? "不存在" : ""}`);
  }

  // 3. Session DB
  const sessionsDbPath = process.env.SESSIONS_DB;
  if (sessionsDbPath && existsSync(sessionsDbPath)) {
    try {
      if (sessions?.getSession) {
        lines.push(`✅ Session DB: ${sessionsDbPath}`);
      } else {
        lines.push(`✅ Session DB: ${sessionsDbPath} (file exists)`);
      }
    } catch {
      lines.push(`❌ Session DB: 读取失败`);
    }
  } else {
    lines.push(`⚠️ Session DB: ${sessionsDbPath || "(未配置)"}`);
  }

  // 4. Tasks DB
  const tasksDbPath = process.env.TASKS_DB;
  if (tasksDbPath && existsSync(tasksDbPath)) {
    lines.push(`✅ Tasks DB: ${tasksDbPath}`);
  } else {
    lines.push(`⚠️ Tasks DB: ${tasksDbPath || "(未配置)"}`);
  }

  // 5. A2A Bus
  if (a2aBus) {
    try {
      const stats = a2aBus.getStats?.();
      lines.push(`✅ A2A Bus: port=${process.env.A2A_PORT || "?"}, received=${stats?.loopGuard?.received || 0}`);
    } catch {
      lines.push(`❌ A2A Bus: 状态获取失败`);
    }
  } else {
    lines.push(`⏭️ A2A: disabled`);
  }

  // 6. Shared Context
  if (sharedContextConfig) {
    const backend = sharedContextConfig.sharedContextBackend || "sqlite";
    lines.push(`✅ Shared Context: ${backend}`);
    const sharedStatus = getSharedContextStatus();
    if (sharedStatus.lastWriteError) {
      lines.push(`⚠️ Shared Context write: ${sharedStatus.lastWriteError.message}`);
    }
    if (backend === "redis") {
      const redisHealth = await checkRedisHealth(sharedContextConfig);
      if (redisHealth.ok) {
        lines.push(`✅ Redis: ping ok`);
      } else {
        lines.push(`❌ Redis: ${redisHealth.error}`);
      }
    }
  } else {
    lines.push(`⏭️ Shared Context: disabled`);
  }

  // 7. Cron
  if (cronManager) {
    const jobList = cronManager.list(chatId);
    const activeCount = jobList.filter((j) => j.status === "active").length;
    const nextJob = jobList.find((j) => j.nextRun);
    const nextStr = nextJob
      ? `, next: ${new Date(nextJob.nextRun).toLocaleTimeString("zh-CN")}`
      : "";
    lines.push(`✅ Cron: ${activeCount} active / ${jobList.length} total${nextStr}`);
  } else {
    lines.push(`⏭️ Cron: disabled`);
  }

  // 8. Rate Limiter
  if (rateLimiter) {
    const stats = rateLimiter.stats(chatId);
    lines.push(`📊 限流: ${stats.used}/${stats.max} used (window ${Math.round(stats.windowMs / 1000)}s)`);
  }

  // 9. Idle Monitor
  if (idleMonitor) {
    const info = idleMonitor.statusInfo();
    const timeoutStr = info.idleTimeoutMs > 0
      ? `${Math.round(info.idleTimeoutMs / 60000)}min`
      : "off";
    const resetStr = info.resetOnIdleMs > 0
      ? `${Math.round(info.resetOnIdleMs / 60000)}min`
      : "off";
    lines.push(`📊 Idle: timeout=${timeoutStr}, reset=${resetStr}, sessions=${info.activeSessions}`);
  }

  // 10. Dir Manager
  if (dirManager) {
    const currentDir = dirManager.current(chatId);
    const hist = dirManager.history(chatId);
    lines.push(`📊 目录: ${currentDir} (history: ${hist.length})`);
  }

  return lines.join("\n");
}
