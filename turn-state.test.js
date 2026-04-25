import { describe, expect, test } from "bun:test";

import { createTaskFinalizer } from "./turn-state.js";

describe("turn state helpers", () => {
  test("finalizes a task exactly once", () => {
    const calls = [];
    const finalizer = createTaskFinalizer({
      taskId: "task-1",
      completeTask: (taskId, summary) => calls.push(["complete", taskId, summary]),
      failTask: (taskId, summary, code) => calls.push(["fail", taskId, summary, code]),
    });

    finalizer.success("done");
    finalizer.failure("late error", "RESULT_ERROR");
    finalizer.success("late success");

    expect(finalizer.finalized).toBe(true);
    expect(calls).toEqual([["complete", "task-1", "done"]]);
  });
});
