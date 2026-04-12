// Streaming Preview — 实时消息编辑显示 AI 流式输出
// 参考: Claude-to-IM bridge-manager.ts:600-659
//
// 工作原理:
// 1. 接管 progress tracker 的消息（或新建一条）
// 2. AI 流式输出时不断 editMessageText 原地更新
// 3. 双重节流：间隔节流 + 增量节流
// 4. 降级：连续编辑失败后停止预览

const DEFAULTS = {
  intervalMs: 700,           // 最小编辑间隔
  minDeltaChars: 20,         // 最少新增字符数才触发
  maxChars: 3900,            // 预览截断长度（TG 限制 4096）
  activationChars: 50,       // 积累多少字符后才激活预览
  maxEditFailures: 3,        // 连续失败次数后降级
};

/**
 * @param {object} ctx - grammy context（需要 ctx.api）
 * @param {number} chatId
 * @param {object} config - 覆盖默认配置
 * @param {object} config.replyMarkup - 可选的 InlineKeyboard（如 Stop 按钮）
 */
export function createStreamingPreview(ctx, chatId, config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const replyMarkup = config.replyMarkup || null;

  let previewMsgId = null;
  let lastSentText = "";
  let lastSentAt = 0;
  let degraded = false;
  let consecutiveFailures = 0;
  let throttleTimer = null;
  let pendingText = "";

  /**
   * 启动预览
   * @param {number} [existingMsgId] - 接管已有消息（如 progress tracker 的消息）
   */
  async function start(existingMsgId) {
    if (existingMsgId) {
      previewMsgId = existingMsgId;
    } else {
      try {
        const opts = replyMarkup ? { reply_markup: replyMarkup } : {};
        const msg = await ctx.api.sendMessage(chatId, "⏳ 正在生成...", opts);
        previewMsgId = msg.message_id;
      } catch {
        degraded = true;
      }
    }
  }

  /**
   * 接收完整文本的增量更新
   * @param {string} fullText - 到目前为止的全部文本
   */
  function onText(fullText) {
    if (degraded || !previewMsgId) return;

    // 截断到 maxChars
    pendingText = fullText.length > cfg.maxChars
      ? fullText.slice(0, cfg.maxChars) + "\n\n⏳ 正在生成..."
      : fullText + "\n\n⏳ 正在生成...";

    const delta = pendingText.length - lastSentText.length;
    const elapsed = Date.now() - lastSentAt;

    // 增量不够 → 调度尾部定时器
    if (delta < cfg.minDeltaChars && lastSentAt > 0) {
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (!degraded) doFlush();
        }, cfg.intervalMs);
      }
      return;
    }

    // 间隔不够 → 调度尾部定时器
    if (elapsed < cfg.intervalMs && lastSentAt > 0) {
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (!degraded) doFlush();
        }, cfg.intervalMs - elapsed);
      }
      return;
    }

    // 立即刷新
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    doFlush();
  }

  function doFlush() {
    if (degraded || !previewMsgId || !pendingText) return;
    if (pendingText === lastSentText) return;

    const textToSend = pendingText;
    const editOpts = replyMarkup ? { reply_markup: replyMarkup } : {};
    ctx.api.editMessageText(chatId, previewMsgId, textToSend, editOpts)
      .then(() => {
        lastSentText = textToSend;
        lastSentAt = Date.now();
        consecutiveFailures = 0;
      })
      .catch((err) => {
        consecutiveFailures++;
        // "message is not modified" 不算真正失败
        if (/not modified/i.test(err?.description || err?.message || "")) {
          consecutiveFailures = 0;
          return;
        }
        if (consecutiveFailures >= cfg.maxEditFailures) {
          console.warn(`[streaming-preview] degraded after ${consecutiveFailures} consecutive failures`);
          degraded = true;
        }
      });
  }

  /**
   * 结束预览，返回消息 ID
   * @returns {number|null}
   */
  function finish() {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    const msgId = previewMsgId;
    previewMsgId = null;
    return msgId;
  }

  function getMessageId() {
    return previewMsgId;
  }

  function isDegraded() {
    return degraded;
  }

  return { start, onText, finish, getMessageId, isDegraded };
}
