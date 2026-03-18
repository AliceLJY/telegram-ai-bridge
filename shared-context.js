// 跨 bot 进程共享的群聊上下文 — 可插拔后端（SQLite / JSON / Redis）
// 保留原导入路径，实际逻辑在 shared-context/ 目录下
export { initSharedContext, writeSharedMessage, readSharedMessages } from "./shared-context/index.js";
