export function createTaskFinalizer({ taskId, completeTask, failTask }) {
  let taskFinalized = false;

  return {
    success(summary = "") {
      if (taskFinalized) return;
      completeTask(taskId, summary);
      taskFinalized = true;
    },
    failure(summary = "", errorCode = "RESULT_ERROR") {
      if (taskFinalized) return;
      failTask(taskId, summary, errorCode);
      taskFinalized = true;
    },
    get finalized() {
      return taskFinalized;
    },
  };
}

export function saveCapturedSession({
  capturedSessionId,
  sessionId,
  chatId,
  prompt,
  backendName,
  sessionType = "normal",
  setSession,
  peekSession = null,
  getResetAt = null,
  turnStartedAt = 0,
  patchCodexStateDb,
  logger = console,
}) {
  if (!capturedSessionId) {
    logger.log(`[Session Debug] NOT saving session: capturedSessionId is null/empty (original sessionId=${sessionId?.slice(0, 8) || "null"})`);
    return false;
  }

  // 防护一：turn 开始后映射被 /new 或 idle-reset 清过 → 放弃写回。
  // 否则被取消/超时 turn 的收尾回调会把旧对话链写回，/new 失效、旧对话复活
  // （历史串台事故同根因）。时间戳比对才能覆盖"清空前映射本来就是空"的新会话场景。
  if (typeof getResetAt === "function" && turnStartedAt > 0) {
    const resetAt = getResetAt(chatId) || 0;
    if (resetAt >= turnStartedAt) {
      logger.log(`[Session Debug] NOT saving session: mapping reset during turn (resetAt=${resetAt} >= turnStartedAt=${turnStartedAt}, captured=${capturedSessionId.slice(0, 8)}...)`);
      return false;
    }
  }

  // 防护二（CAS）：映射在 turn 期间被切到别的会话（/resume 等）→ 放弃写回。
  // current === captured 时放行（本 turn 已写过，幂等）。peekSession 无 touch 副作用。
  if (typeof peekSession === "function") {
    const current = peekSession(chatId);
    const currentId = current?.session_id || null;
    const startedFrom = sessionId || null;
    if (currentId !== startedFrom && currentId !== capturedSessionId) {
      logger.log(`[Session Debug] NOT saving session: mapping changed during turn (started=${startedFrom?.slice(0, 8) || "null"}, now=${currentId?.slice(0, 8) || "null"}, captured=${capturedSessionId.slice(0, 8)}...)`);
      return false;
    }
  }

  const displayName = prompt.slice(0, 30);
  logger.log(`[Session Debug] Saving session: chatId=${chatId} sessionId=${capturedSessionId.slice(0, 8)}... backend=${backendName} (was=${sessionId?.slice(0, 8) || "null"})`);
  setSession(chatId, capturedSessionId, displayName, backendName, "owned", sessionType);
  if (backendName === "codex") {
    setTimeout(patchCodexStateDb, 1000);
  }
  return true;
}

export async function finishTurnProgress({
  previewActivated,
  streamPreview,
  progress,
  chatId,
  resultSuccess,
  verboseLevel,
  keepAsSummary = true,
  durationMs,
  deleteMessage,
  activeProgressTrackers,
}) {
  if (previewActivated) {
    const previewMsgId = streamPreview.finish();
    if (previewMsgId) {
      deleteMessage(chatId, previewMsgId);
    }
    await progress.finish({ skipMessage: true });
  } else {
    await progress.finish({
      keepAsSummary: keepAsSummary && verboseLevel >= 1 && resultSuccess,
      durationMs,
    });
  }
  activeProgressTrackers?.delete(chatId);
}
