// kimi 流式路径端到端测试：用假 CLI 脚本喷固定 stream-json 帧，
// 验证 streamParse 接入后 streamQuery 的事件序列、最终 result、错误路径。
// KIMI_BIN 在 kimi.js 模块加载时读取，所以先设 env 再动态 import。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let dir;
let createAdapter;

function fakeKimi(name, stdoutLines, exitCode = 0, stderrText = "") {
  const path = join(dir, name);
  const script = [
    "#!/bin/bash",
    `cat <<'KIMI_EOF'`,
    stdoutLines,
    `KIMI_EOF`,
    stderrText ? `echo '${stderrText}' >&2` : ":",
    `exit ${exitCode}`,
  ].join("\n");
  writeFileSync(path, script + "\n");
  chmodSync(path, 0o755);
  return path;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "kimi-fake-"));
  process.env.KIMI_BIN = join(dir, "kimi-ok");
  ({ createAdapter } = await import("./kimi.js"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.KIMI_BIN;
});

async function collect(adapter, prompt = "测试") {
  const events = [];
  for await (const ev of adapter.streamQuery(prompt, null, new AbortController().signal)) {
    events.push(ev);
  }
  return events;
}

describe("kimi adapter 流式路径", () => {
  test("step 级帧 → progress / text / session_init / result 完整序列", async () => {
    fakeKimi("kimi-ok", [
      '{"role":"assistant","tool_calls":[{"type":"function","id":"t1","function":{"name":"Bash","arguments":"{\\"command\\":\\"echo hi\\"}"}}]}',
      '{"role":"tool","tool_call_id":"t1","content":"hi\\n"}',
      '{"role":"assistant","content":"答案是 hi"}',
      '{"role":"meta","type":"session.resume_hint","session_id":"session_test123","command":"kimi -r session_test123"}',
    ].join("\n"));
    process.env.KIMI_BIN = join(dir, "kimi-ok");
    const events = await collect(createAdapter({ cwd: "/tmp" }));

    expect(events[0]).toMatchObject({ type: "progress", toolName: "Bash", detail: "echo hi" });
    expect(events[1]).toEqual({ type: "text", text: "答案是 hi" });
    expect(events[2]).toEqual({ type: "session_init", sessionId: "session_test123" });
    const result = events[3];
    expect(result).toMatchObject({ type: "result", success: true, text: "答案是 hi" });
    // tool 结果帧不产生事件
    expect(events.filter((e) => e.type === "progress")).toHaveLength(1);
  });

  test("多条 assistant 正文帧全部累积进 result.text（与旧缓冲路径语义一致）", async () => {
    fakeKimi("kimi-multi", [
      '{"role":"assistant","content":"先跑个命令。"}',
      '{"role":"assistant","tool_calls":[{"type":"function","id":"t2","function":{"name":"Read","arguments":"{\\"file_path\\":\\"/tmp/a.txt\\"}"}}]}',
      '{"role":"tool","tool_call_id":"t2","content":"x"}',
      '{"role":"assistant","content":"读完，结论是 y。"}',
      '{"role":"meta","type":"session.resume_hint","session_id":"session_abc"}',
    ].join("\n"));
    process.env.KIMI_BIN = join(dir, "kimi-multi");
    const events = await collect(createAdapter({ cwd: "/tmp" }));
    const result = events.find((e) => e.type === "result");

    expect(result.success).toBe(true);
    expect(result.text).toBe("先跑个命令。读完，结论是 y。");
    const progress = events.find((e) => e.type === "progress");
    expect(progress).toMatchObject({ toolName: "Read", detail: "/tmp/a.txt" });
  });

  test("错误路径：无帧 + exit≠0 → success:false，stderr 进错误信息", async () => {
    fakeKimi("kimi-err", "", 1, "error: failed to run prompt: config.invalid");
    process.env.KIMI_BIN = join(dir, "kimi-err");
    const events = await collect(createAdapter({ cwd: "/tmp" }));
    const result = events.find((e) => e.type === "result");

    expect(result.success).toBe(false);
    expect(result.text).toContain("config.invalid");
  });

  test("半行/噪音行被容忍，不中断解析", async () => {
    fakeKimi("kimi-noisy", [
      "一些非 JSON 的日志行",
      '{"role":"assistant","content":"ok',
      '{"role":"assistant","content":"正常答案"}',
      '{"role":"meta","type":"session.resume_hint","session_id":"session_noise"}',
    ].join("\n"));
    process.env.KIMI_BIN = join(dir, "kimi-noisy");
    const events = await collect(createAdapter({ cwd: "/tmp" }));
    const result = events.find((e) => e.type === "result");

    expect(result.success).toBe(true);
    expect(result.text).toBe("正常答案");
  });
});
