// Markdown → Telegram HTML 转换器
// 将 Claude 的标准 Markdown 输出转换为 Telegram Bot API 支持的 HTML 格式
//
// 支持: 代码块、行内代码、粗体、斜体、删除线、标题、链接、引用
// 策略: 保守转换 + parse_error 降级纯文本

/**
 * HTML 实体转义（非 tag 区域）
 */
function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 将标准 Markdown 转换为 Telegram HTML
 * @param {string} text - Claude 输出的 Markdown 文本
 * @returns {string} Telegram HTML
 */
export function markdownToTelegramHTML(text) {
  if (!text) return text;

  // ── Phase 1: 提取代码块和行内代码，用占位符保护 ──
  const placeholders = [];

  // 1a. 提取 fenced code blocks: ```lang\ncode\n```
  let result = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = placeholders.length;
    const escaped = escapeHTML(code.trimEnd());
    const tag = lang
      ? `<pre><code class="language-${escapeHTML(lang)}">${escaped}</code></pre>`
      : `<pre><code>${escaped}</code></pre>`;
    placeholders.push(tag);
    return `\x00PH${idx}\x00`;
  });

  // 1b. 提取行内代码: `code`
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    const idx = placeholders.length;
    placeholders.push(`<code>${escapeHTML(code)}</code>`);
    return `\x00PH${idx}\x00`;
  });

  // ── Phase 2: 转义 HTML 实体 ──
  result = escapeHTML(result);

  // ── Phase 3: Markdown → HTML 格式转换 ──

  // 标题 → 粗体（Telegram 没有 heading 标签）
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // 粗体: **text** 或 __text__（先于斜体处理）
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // 斜体: *text*（排除词内 * 和 URL 中的 *）
  result = result.replace(/(?<![\\*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?![*\w])/g, "<i>$1</i>");

  // 斜体: _text_（排除词内 _ 和 URL/变量名中的 _）
  result = result.replace(/(?<![_\w])_([^\s_](?:[^_]*[^\s_])?)_(?![_\w])/g, "<i>$1</i>");

  // 删除线: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 链接: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 引用块: > text（转义后 > 变成 &gt;）
  result = result.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");
  // 合并连续引用为一个 blockquote
  result = result.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // ── Phase 4: 恢复占位符 ──
  result = result.replace(/\x00PH(\d+)\x00/g, (_match, idx) => placeholders[Number(idx)]);

  return result;
}

/**
 * 检测文本是否包含值得转换的 Markdown 格式
 * 纯文本没必要走 HTML 转换（省开销，降低 parse_error 风险）
 */
export function hasMarkdownFormatting(text) {
  if (!text) return false;
  return /```|`[^`]+`|\*\*|__|~~|^#{1,6}\s|^>\s/m.test(text);
}
