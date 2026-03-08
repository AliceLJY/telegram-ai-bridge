export function encodeMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

export function parseMessage(line) {
  return JSON.parse(String(line || "").trim());
}
