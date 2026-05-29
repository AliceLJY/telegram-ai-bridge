import { existsSync, readFileSync } from "fs";
import { basename } from "path";

const SENDABLE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".docx", ".xlsx", ".csv", ".html", ".svg"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const DOC_EXTS = new Set([".pdf", ".docx", ".xlsx", ".csv", ".html", ".txt", ".md", ".json", ".js", ".ts", ".py", ".sh", ".yaml", ".yml", ".xml", ".log", ".zip", ".tar", ".gz"]);

export function extractFilePathsFromText(text, fileList, options = {}) {
  const home = options.home ?? process.env.HOME ?? "";
  const exists = options.exists ?? existsSync;
  const existing = new Set(fileList.map(f => f.filePath));
  const extGroup = "png|jpg|jpeg|gif|webp|pdf|docx|xlsx|csv|html|svg|txt|md|json|js|ts|py|sh|yaml|yml|xml|log|zip|tar|gz";

  const absPattern = new RegExp(`(\\/(?:[\\w.\\-]+\\/)*[\\w.\\-\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef ]+\\.(?:${extGroup}))`, "gi");
  const tildePattern = new RegExp(`(~\\/(?:[\\w.\\-]+\\/)*[\\w.\\-\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef ]+\\.(?:${extGroup}))`, "gi");

  function addPath(path) {
    const resolved = path.startsWith("~/") ? path.replace("~", home) : path.trim();
    if (!existing.has(resolved) && exists(resolved)) {
      existing.add(resolved);
      fileList.push({ filePath: resolved, source: "text_scan" });
    }
  }

  for (const match of text.match(absPattern) || []) addPath(match);
  for (const match of text.match(tildePattern) || []) addPath(match);
}

// 把后端（Codex / Claude SDK）的原始错误 stderr 压成用户能看懂的一句话。
// 满屏 TLS handshake / rmcp / apply_patch / rollout trace 对用户没有行动价值，
// 原样发到 Telegram 只会吓人——完整 stderr 只进后台日志，这里只回传归类后的人话。
const BACKEND_ERROR_PATTERNS = [
  {
    re: /tls handshake|failed to connect to websocket|http\/?request failed|transport channel closed|wham\/apps|backend-api\/codex\/responses|websocket|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i,
    msg: "与模型后端的连接中断了一次（网络或 TLS 握手失败）",
  },
  {
    re: /apply_patch verification failed|failed to find expected lines/i,
    msg: "某次文件修改的上下文已过期，该次改动被自动跳过（不影响其他结果）",
  },
  {
    re: /thread .*not found|failed to record rollout items/i,
    msg: "会话记录层出现一次短暂不一致（本地会话文件仍在）",
  },
  {
    re: /rate.?limit|\b429\b|quota|usage limit/i,
    msg: "触发了模型用量限制，建议稍后重试",
  },
  {
    re: /not installed|ENOENT|command not found|cannot find module/i,
    msg: "后端依赖缺失或未正确安装",
  },
  {
    re: /exited with code|exit code|non-zero|Codex Exec/i,
    msg: "后端进程异常退出了一次",
  },
];

export function sanitizeBackendError(rawText, { maxLen = 200 } = {}) {
  const raw = String(rawText || "").replace(/\r/g, "").trim();
  if (!raw) return "后端未返回错误详情";

  const hits = [];
  for (const { re, msg } of BACKEND_ERROR_PATTERNS) {
    if (re.test(raw) && !hits.includes(msg)) hits.push(msg);
  }
  if (hits.length > 0) {
    return `${hits.join("；")}。完整日志见后台。`;
  }

  // 未识别模式：只取首条非空行 + 长度上限，绝不把整屏 trace 回传给用户
  const firstLine = raw.split("\n").map((l) => l.trim()).find(Boolean) || raw;
  const short = firstLine.length > maxLen ? `${firstLine.slice(0, maxLen - 3)}...` : firstLine;
  return `${short}（完整日志见后台）`;
}

export function estimateCodeRatio(text) {
  const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
  const codeLen = codeBlocks.reduce((sum, block) => sum + block.length, 0);
  return text.length > 0 ? codeLen / text.length : 0;
}

export function detectCodeLang(text) {
  const match = text.match(/```(\w+)/);
  const lang = match?.[1]?.toLowerCase();
  const map = { javascript: "js", typescript: "ts", python: "py", bash: "sh", shell: "sh", ruby: "rb" };
  return map[lang] || lang || "txt";
}

export async function sendCapturedOutputs({
  chatId,
  resultSuccess,
  capturedImages,
  capturedFiles,
  imageFloodSuppressed,
  fileDir,
  sendPhoto,
  sendDocument,
  logger = console,
  home = process.env.HOME ?? "",
  exists = existsSync,
  readFile = readFileSync,
  basenameFn = basename,
  sleepMs = 300,
}) {
  if (capturedImages.length > 0 || capturedFiles.length > 0) {
    logger.log(`[Bridge] 输出回传: ${capturedImages.length} 张图片${imageFloodSuppressed ? " (防刷已触发，部分跳过)" : ""}, ${capturedFiles.length} 个文件`);
  }

  if (resultSuccess && capturedImages.length > 0) {
    let sentImageCount = 0;
    for (const img of capturedImages) {
      if (img.source === "tool_result") {
        logger.log(`[Bridge] 跳过工具结果图片 (toolUseId: ${img.toolUseId || "?"})`);
        continue;
      }
      try {
        const buf = Buffer.from(img.data, "base64");
        if (buf.length > 10 * 1024 * 1024) continue;
        const ext = (img.mediaType || "image/png").split("/")[1] || "png";
        await sendPhoto(chatId, buf, `output.${ext}`);
        sentImageCount++;
        if (sentImageCount < capturedImages.length) {
          await new Promise(resolve => setTimeout(resolve, sleepMs));
        }
      } catch (error) {
        logger.error(`[Bridge] sendPhoto failed: ${error.message}`);
      }
    }
  }

  if (resultSuccess && capturedFiles.length > 0) {
    const sentPaths = new Set();
    for (const file of capturedFiles) {
      if (!file.filePath) continue;
      const resolved = file.filePath.startsWith("~/") ? file.filePath.replace("~", home) : file.filePath;
      if (fileDir && resolved.startsWith(fileDir)) continue;
      if (sentPaths.has(resolved)) continue;
      const ext = resolved.slice(resolved.lastIndexOf(".")).toLowerCase();
      if (!IMAGE_EXTS.has(ext) && !DOC_EXTS.has(ext)) continue;
      if (!exists(resolved)) continue;
      sentPaths.add(resolved);
      logger.log(`[Bridge] 发送文件: ${basenameFn(resolved)} (来源: ${file.source})`);
      try {
        if (IMAGE_EXTS.has(ext)) {
          await sendPhoto(chatId, readFile(resolved), basenameFn(resolved));
        } else {
          await sendDocument(chatId, readFile(resolved), basenameFn(resolved));
        }
      } catch (error) {
        logger.error(`[Bridge] sendFile failed (${basenameFn(resolved)}): ${error.message}`);
      }
    }
  }
}

export async function sendFinalResult({
  ctx,
  chatId,
  adapterLabel,
  resultText,
  resultSuccess,
  finalizeSuccess,
  finalizeFailure,
  summarizeText,
  detectQuickReplies,
  InlineKeyboard,
  sendLong,
  sendDocument,
  protectFileReferences,
  hasMarkdownFormatting,
  markdownToTelegramHTML,
  withRetry,
}) {
  let text = resultText ? protectFileReferences(resultText) : resultText;

  // 让最终结果在 Telegram 上 quote 触发本次任务的原消息，对齐"提问↔答案"视觉关系
  const _mid = ctx?.message?.message_id;
  const quote = _mid
    ? { reply_parameters: { message_id: _mid, allow_sending_without_reply: true } }
    : {};

  if (!resultSuccess) {
    finalizeFailure(summarizeText(text, 240), "RESULT_ERROR");
    // 不把后端整屏 raw stderr 发给用户，只发归类后的人话；完整 stderr 已在 bridge 日志里
    await sendLong(ctx, `${adapterLabel} 出错：${sanitizeBackendError(text)}`);
    return text;
  }

  if (!text) {
    finalizeSuccess("");
    await ctx.reply(`${adapterLabel} 无输出。`, quote);
    return text;
  }

  finalizeSuccess(summarizeText(text, 240));
  const replies = detectQuickReplies(text);
  if (replies && text.length <= 4000) {
    const kb = new InlineKeyboard();
    for (const reply of replies) {
      let cbSuffix = reply;
      while (Buffer.byteLength(`reply:${cbSuffix}`, "utf-8") > 64) {
        cbSuffix = cbSuffix.slice(0, -1);
      }
      kb.text(reply, `reply:${cbSuffix}`);
    }
    if (hasMarkdownFormatting(text)) {
      await withRetry(
        () => ctx.reply(markdownToTelegramHTML(text), { reply_markup: kb, parse_mode: "HTML", ...quote }),
        { onParseFallback: () => ctx.reply(text, { reply_markup: kb, ...quote }) },
      );
    } else {
      await ctx.reply(text, { reply_markup: kb, ...quote });
    }
  } else if (text.length > 4000 && estimateCodeRatio(text) > 0.6) {
    const ext = detectCodeLang(text) || "txt";
    await sendDocument(chatId, Buffer.from(text, "utf-8"), `output.${ext}`);
    const preview = text.slice(0, 300).replace(/```\w*\n?/, "");
    await ctx.reply(`${preview}\n\n📎 完整输出 (${text.length} 字符) 见附件`, quote);
  } else {
    await sendLong(ctx, text);
  }

  return text;
}

// 把长文本按 Telegram 4096 字符限制切成多段：智能切段（优先空行/换行）+ 跨段代码块修补。
// 纯函数，由 sendLong（带 ctx）和 A2A handler（只有 bot.api，无 ctx）共用——
// 避免 A2A 回复裸 sendMessage 超长被 Telegram 400 拒绝、用户看不到（与静默吞同类临床问题）。
export function splitTelegramChunks(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  let prevUnclosed = false; // 上一段是否有未闭合的代码块
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n\n", maxLen); // 优先段落
    if (cut < maxLen * 0.3) {
      cut = remaining.lastIndexOf("\n", maxLen);     // 其次换行
    }
    if (cut < maxLen * 0.3) {
      cut = maxLen;                                   // 兜底硬切
    }
    let chunk = remaining.slice(0, cut);
    if (prevUnclosed) {
      chunk = "```\n" + chunk;
    }
    const fenceCount = (chunk.match(/^```/gm) || []).length;
    if (fenceCount % 2 !== 0) {
      chunk += "\n```";
      prevUnclosed = true;
    } else {
      prevUnclosed = false;
    }
    chunks.push(chunk);
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining) {
    if (prevUnclosed) remaining = "```\n" + remaining;
    chunks.push(remaining);
  }
  return chunks;
}

export { SENDABLE_EXTS };
