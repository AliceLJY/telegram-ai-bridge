// 定时任务管理器（借鉴 cc-connect cron.go）
// 标准 cron 表达式，SQLite 持久化，独立 session 执行

import { Cron } from "croner";

export function createCronManager(options = {}) {
  const {
    db = null,           // bun:sqlite Database 实例
    maxJobs = 10,
    defaultTimeoutMs = 10 * 60 * 1000,  // 10 分钟
    onExecute = null,    // async (job) => string  执行任务，返回结果文本
    onOutput = null,     // async (chatId, text) => {}  通知用户
  } = options;

  // 内存中的活跃 cron 实例
  const jobs = new Map(); // id -> { meta, cron }

  // ── 初始化 DB 表 ──
  function initDb() {
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        chat_id INTEGER NOT NULL,
        cron_expr TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        timeout_ms INTEGER DEFAULT ${defaultTimeoutMs},
        created_at TEXT NOT NULL,
        last_run_at TEXT,
        last_result TEXT
      )
    `);
  }

  initDb();

  function generateId() {
    return `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function add(chatId, cronExpr, prompt, opts = {}) {
    // 检查上限
    const chatJobs = [...jobs.values()].filter((j) => j.meta.chatId === chatId);
    if (chatJobs.length >= maxJobs) {
      return { ok: false, error: `已达上限 ${maxJobs} 个任务` };
    }

    // 验证 cron 表达式
    let testCron;
    try {
      testCron = new Cron(cronExpr, { paused: true });
      testCron.stop();
    } catch (e) {
      return { ok: false, error: `无效的 cron 表达式: ${e.message}` };
    }

    const id = generateId();
    const timeoutMs = opts.timeoutMs || defaultTimeoutMs;
    const now = new Date().toISOString();

    const meta = {
      id,
      chatId,
      cronExpr,
      prompt,
      status: "active",
      timeoutMs,
      createdAt: now,
      lastRunAt: null,
      lastResult: null,
    };

    // 持久化
    if (db) {
      db.prepare(`
        INSERT INTO cron_jobs (id, chat_id, cron_expr, prompt, status, timeout_ms, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(id, chatId, cronExpr, prompt, timeoutMs, now);
    }

    // 启动 cron
    const cronInstance = new Cron(cronExpr, async () => {
      await executeJob(meta);
    });

    jobs.set(id, { meta, cron: cronInstance });

    return {
      ok: true,
      id,
      nextRun: cronInstance.nextRun()?.toISOString() || null,
    };
  }

  async function executeJob(meta) {
    const startTime = Date.now();
    meta.lastRunAt = new Date().toISOString();

    if (db) {
      db.prepare("UPDATE cron_jobs SET last_run_at = ? WHERE id = ?")
        .run(meta.lastRunAt, meta.id);
    }

    let result = "";
    try {
      if (onExecute) {
        // 带超时执行
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(
            `超时 (${Math.round(meta.timeoutMs / 60000)} 分钟)`
          )), meta.timeoutMs);
        });

        result = await Promise.race([
          onExecute(meta),
          timeoutPromise,
        ]);
      }
    } catch (e) {
      result = `执行失败: ${e.message}`;
    }

    const duration = Date.now() - startTime;
    meta.lastResult = result?.slice(0, 500) || "(无输出)";

    if (db) {
      db.prepare("UPDATE cron_jobs SET last_result = ? WHERE id = ?")
        .run(meta.lastResult, meta.id);
    }

    // 通知用户
    if (onOutput) {
      const summary = [
        `⏰ 定时任务完成`,
        `任务: ${meta.prompt.slice(0, 60)}`,
        `耗时: ${Math.round(duration / 1000)}s`,
        `结果: ${meta.lastResult.slice(0, 200)}`,
      ].join("\n");
      try {
        await onOutput(meta.chatId, summary);
      } catch (e) {
        console.error(`[cron] 通知失败: ${e.message}`);
      }
    }
  }

  function remove(id) {
    const job = jobs.get(id);
    if (!job) return false;

    job.cron.stop();
    jobs.delete(id);

    if (db) {
      db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id);
    }
    return true;
  }

  function pause(id) {
    const job = jobs.get(id);
    if (!job) return false;
    job.cron.pause();
    job.meta.status = "paused";
    if (db) {
      db.prepare("UPDATE cron_jobs SET status = 'paused' WHERE id = ?").run(id);
    }
    return true;
  }

  function resume(id) {
    const job = jobs.get(id);
    if (!job) return false;
    job.cron.resume();
    job.meta.status = "active";
    if (db) {
      db.prepare("UPDATE cron_jobs SET status = 'active' WHERE id = ?").run(id);
    }
    return true;
  }

  function list(chatId = null) {
    const result = [];
    for (const [, job] of jobs) {
      if (chatId != null && job.meta.chatId !== chatId) continue;
      const nextRun = job.meta.status === "active"
        ? job.cron.nextRun()?.toISOString() || null
        : null;
      result.push({ ...job.meta, nextRun });
    }
    return result;
  }

  // 从 DB 恢复任务（启动时调用）
  function restore() {
    if (!db) return 0;
    const rows = db.prepare("SELECT * FROM cron_jobs WHERE status = 'active'").all();
    let count = 0;
    for (const row of rows) {
      try {
        const meta = {
          id: row.id,
          chatId: row.chat_id,
          cronExpr: row.cron_expr,
          prompt: row.prompt,
          status: row.status,
          timeoutMs: row.timeout_ms || defaultTimeoutMs,
          createdAt: row.created_at,
          lastRunAt: row.last_run_at,
          lastResult: row.last_result,
        };

        const cronInstance = new Cron(row.cron_expr, async () => {
          await executeJob(meta);
        });

        jobs.set(row.id, { meta, cron: cronInstance });
        count++;
      } catch (e) {
        console.warn(`[cron] 恢复任务 ${row.id} 失败: ${e.message}`);
      }
    }
    return count;
  }

  function stopAll() {
    for (const [, job] of jobs) {
      job.cron.stop();
    }
    jobs.clear();
  }

  function count(chatId = null) {
    if (chatId == null) return jobs.size;
    return [...jobs.values()].filter((j) => j.meta.chatId === chatId).length;
  }

  return { add, remove, pause, resume, list, restore, stopAll, count };
}
