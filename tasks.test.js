import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tempDirs = [];
const originalTasksDb = process.env.TASKS_DB;

afterEach(() => {
  if (originalTasksDb == null) delete process.env.TASKS_DB;
  else process.env.TASKS_DB = originalTasksDb;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function importTasks(dbPath) {
  process.env.TASKS_DB = dbPath;
  return import(`./tasks.js?test=${Date.now()}-${Math.random()}`);
}

describe("tasks retention", () => {
  test("cleanupOldTasks prunes old finished tasks while keeping recent rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "telegram-ai-bridge-tasks-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "tasks.db");
    const tasks = await importTasks(dbPath);
    const oldTaskId = tasks.createTask({
      chatId: 1,
      backend: "claude",
      executor: "direct",
      capability: "ai_turn",
      action: "stream_query",
      promptSummary: "old",
    });
    const recentTaskId = tasks.createTask({
      chatId: 1,
      backend: "claude",
      executor: "direct",
      capability: "ai_turn",
      action: "stream_query",
      promptSummary: "recent",
    });

    const now = Date.now();
    const oldTs = now - 15 * 24 * 60 * 60 * 1000;
    const db = new Database(dbPath);
    db.prepare("UPDATE tasks SET status = 'completed', finished_at = ?, updated_at = ? WHERE task_id = ?")
      .run(oldTs, oldTs, oldTaskId);
    db.prepare("UPDATE tasks SET status = 'completed', finished_at = ?, updated_at = ? WHERE task_id = ?")
      .run(now, now, recentTaskId);
    db.close();

    const result = tasks.cleanupOldTasks({ retentionDays: 14, minRows: 0 });

    expect(result.deleted).toBe(1);
    expect(tasks.recentTasks(1, 10).map((task) => task.task_id)).toEqual([recentTaskId]);
  });
});
