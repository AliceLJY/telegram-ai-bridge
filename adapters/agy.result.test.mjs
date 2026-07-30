// normalizeAgyResult 的最小检查：`node adapters/agy.result.test.mjs`（无框架，assert 级）
// 三条 fixture 都是从真实 agy 输出抄下来的形态，2026-07-30 实测。
import assert from "assert";
import { normalizeAgyResult } from "./agy.js";

// 1. 正常成功
const ok = normalizeAgyResult({
  conversation_id: "5fbc82f9",
  status: "SUCCESS",
  response: "在的\n",
});
assert.strictEqual(ok.success, true);
assert.strictEqual(ok.text, "在的\n");
assert.strictEqual(ok.sessionId, "5fbc82f9");
assert.strictEqual(ok.error, null);

// 2. status=ERROR 但正文已生成（长会话撞 retryable 网络错误的实测形态）——正文必须保住
const partial = normalizeAgyResult({
  conversation_id: "38ca0a41",
  status: "ERROR",
  response: "收到\n",
  error: "Encountered retryable error from model provider: There was a network issue connecting to the server, please try again.",
});
assert.strictEqual(partial.success, true, "有正文就不能判死");
assert.ok(partial.text.includes("收到"), "正文必须保住");
assert.ok(partial.text.includes("network issue"), "agy 的错误原话要附上");
assert.strictEqual(partial.sessionId, "38ca0a41");

// 3. 真失败：无正文（参数冲突的实测形态）——error 必须带上 agy 原话，不能只剩 status
const failed = normalizeAgyResult({
  conversation_id: "",
  status: "ERROR",
  response: "",
  error: '--model gemini-3.1-pro-high conflicts with --effort=low',
});
assert.strictEqual(failed.success, false);
assert.ok(failed.error.includes("conflicts with"), "真因不能被 status=ERROR 吞掉");

// 4. 兜底：连 status 都没有
const empty = normalizeAgyResult({});
assert.strictEqual(empty.success, false);
assert.ok(empty.error.includes("(未知)"));

console.log("normalizeAgyResult: 4/4 通过");
