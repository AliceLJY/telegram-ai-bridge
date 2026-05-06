export function parseTelegramCommandTarget(text) {
  const match = String(text || "").match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?=\s|$)/);
  if (!match) return null;
  return {
    command: match[1],
    targetUsername: match[2] || null,
  };
}

export function parseMentionFirstCommand(text, botUsername) {
  const username = String(botUsername || "").replace(/^@/, "").trim();
  if (!username) return null;

  const match = String(text || "").trim().match(/^@([A-Za-z0-9_]+)\s+\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  const mentionedUsername = match[1];
  if (mentionedUsername.toLowerCase() !== username.toLowerCase()) return null;

  const explicitTarget = match[3] || null;
  if (explicitTarget && explicitTarget.toLowerCase() !== username.toLowerCase()) return null;

  return {
    command: match[2],
    targetUsername: explicitTarget || username,
    args: String(match[4] || "").trim(),
  };
}

export function isCommandForAnotherBot(text, botUsername) {
  const parsed = parseTelegramCommandTarget(text);
  if (!parsed?.targetUsername || !botUsername) return false;
  return parsed.targetUsername.toLowerCase() !== String(botUsername).toLowerCase();
}
