/**
 * 公共工具函数 — estimateTokens + trimByTokens
 */

/**
 * 估算 token 数（与 bridge.js 保持一致）
 */
export function estimateTokens(text) {
  const cjkChars = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
  const wordChars = (text.match(/[A-Za-z0-9_]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  const restChars = Math.max(0, text.length - cjkChars - wordChars);
  return cjkChars + words + Math.ceil(restChars / 3);
}

/**
 * token 裁剪：从最旧的开始丢，直到总 token 数 <= maxTokens
 * @param {Array} rows - 按时间正序排列的消息数组（会被 mutate）
 * @param {number} maxTokens
 * @returns {Array} 裁剪后的数组（同一引用）
 */
export function trimByTokens(rows, maxTokens) {
  let total = rows.reduce((sum, r) => sum + r.tokens, 0);
  while (rows.length > 0 && total > maxTokens) {
    total -= rows.shift().tokens;
  }
  return rows;
}
