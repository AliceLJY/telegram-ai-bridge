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
  setSession,
  patchCodexStateDb,
  logger = console,
}) {
  if (!capturedSessionId) {
    logger.log(`[Session Debug] NOT saving session: capturedSessionId is null/empty (original sessionId=${sessionId?.slice(0, 8) || "null"})`);
    return false;
  }

  const displayName = prompt.slice(0, 30);
  logger.log(`[Session Debug] Saving session: chatId=${chatId} sessionId=${capturedSessionId.slice(0, 8)}... backend=${backendName} (was=${sessionId?.slice(0, 8) || "null"})`);
  setSession(chatId, capturedSessionId, displayName, backendName, "owned");
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
      keepAsSummary: verboseLevel >= 1 && resultSuccess,
      durationMs,
    });
  }
  activeProgressTrackers?.delete(chatId);
}
