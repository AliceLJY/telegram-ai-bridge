// 被中断时（idle-monitor 超时 / 用户点 Stop）必须把已经流下来的正文交出来。
//
// 现场（2026-07-30）：让 agy 去跑 CC / Kimi 这类长子任务，它在等子进程期间既无正文增量
// 也不再发 tool ACTIVE，心跳没人按 → 撞 idle-monitor 的 30 分钟闸被 abort。旧逻辑丢掉
// accumulated，31 分钟的产出只换回一句"调用被中断"。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let dir;
let createAdapter;

/** 假 agy：先喷若干 stream-json 帧，再挂住不退（模拟等子进程的静默期）。
 *
 * `trap` + 后台 sleep + wait 是刻意的：裸 `sleep` 会让 bash 攥着 SIGTERM 不放，直到前台
 * 命令自己结束——那样测的就是 bash 的信号语义，而不是 adapter 的中断路径。真 agy 是 Go
 * 程序，收到 SIGTERM 会自己退，这里照它的行为写。 */
function fakeAgy(name, stdoutLines, hangSeconds = 2) {
  const path = join(dir, name);
  const script = [
    "#!/bin/bash",
    "trap 'exit 143' TERM",
    "cat <<'AGY_EOF'",
    stdoutLines,
    "AGY_EOF",
    // 静默期：不再有任何输出，正是心跳断掉的那段
    `sleep ${hangSeconds} &`,
    "wait $!",
  ].join("\n");
  writeFileSync(path, script + "\n");
  chmodSync(path, 0o755);
  return path;
}

const textFrame = (delta) =>
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "conv-abort-test",
      step_index: 2,
      state: "DONE",
      step_type: "agent_response",
      text_delta: delta,
    },
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "agy-fake-"));
  ({ createAdapter } = await import("./agy.js"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// 两个用例复写同一个文件名，靠改写内容切换行为；binary 通过 adapter config 注入，
// 不依赖 Bun 在多测试文件之间复用 ESM module cache 时的导入顺序。
const BIN_NAME = "agy-hang";

/** 收事件，攒到 minTextEvents 条正文后主动 abort（模拟超时闸/Stop）。 */
async function collectThenAbort(adapter, minTextEvents = 2) {
  const controller = new AbortController();
  const events = [];
  let seen = 0;
  for await (const ev of adapter.streamQuery("测试", null, controller.signal)) {
    events.push(ev);
    if (ev.type === "text" && ++seen >= minTextEvents) controller.abort();
  }
  return events;
}

describe("agy 被中断时的部分产出", () => {
  test("已生成的正文必须随中断一起交出，而不是被丢弃", async () => {
    fakeAgy(BIN_NAME, [textFrame("第一段结论。"), textFrame("第二段推导。")].join("\n"));

    const events = await collectThenAbort(createAdapter({ cwd: "/tmp", bin: join(dir, BIN_NAME) }));
    const result = events.at(-1);

    expect(result.type).toBe("result");
    expect(result.success).toBe(true);
    expect(result.text).toContain("第一段结论。");
    expect(result.text).toContain("第二段推导。");
    expect(result.text).toContain("被中断");
    expect(result.text).toContain("可能不完整");
  });

  test("中断前什么都没生成 → 仍然报失败，不伪造成功", async () => {
    // 只有 init 帧、零正文增量（init 不带 conversation_id → streamParse 返回 null，accumulated 为空）
    fakeAgy(BIN_NAME, JSON.stringify({ event: "init", init: { model: "gemini-3.1-pro-high" } }), 2);

    const controller = new AbortController();
    const events = [];
    setTimeout(() => controller.abort(), 300);
    for await (const ev of createAdapter({ cwd: "/tmp", bin: join(dir, BIN_NAME) }).streamQuery("测试", null, controller.signal)) {
      events.push(ev);
    }

    const result = events.at(-1);
    expect(result.type).toBe("result");
    expect(result.success).toBe(false);
    expect(result.text).toContain("被中断");
  });
});
