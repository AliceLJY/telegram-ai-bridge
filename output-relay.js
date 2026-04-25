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

  if (!resultSuccess) {
    finalizeFailure(summarizeText(text, 240), "RESULT_ERROR");
    await sendLong(ctx, `${adapterLabel} 错误: ${text}`);
    return text;
  }

  if (!text) {
    finalizeSuccess("");
    await ctx.reply(`${adapterLabel} 无输出。`);
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
        () => ctx.reply(markdownToTelegramHTML(text), { reply_markup: kb, parse_mode: "HTML" }),
        { onParseFallback: () => ctx.reply(text, { reply_markup: kb }) },
      );
    } else {
      await ctx.reply(text, { reply_markup: kb });
    }
  } else if (text.length > 4000 && estimateCodeRatio(text) > 0.6) {
    const ext = detectCodeLang(text) || "txt";
    await sendDocument(chatId, Buffer.from(text, "utf-8"), `output.${ext}`);
    const preview = text.slice(0, 300).replace(/```\w*\n?/, "");
    await ctx.reply(`${preview}\n\n📎 完整输出 (${text.length} 字符) 见附件`);
  } else {
    await sendLong(ctx, text);
  }

  return text;
}

export { SENDABLE_EXTS };
