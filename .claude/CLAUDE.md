# telegram-ai-bridge 运维规则

## 第一步永远是读手册

任何运维操作开始前，必须先读：
1. `~/Documents/运维手册/操作指南.md` — 五 bot 架构、配置目录
2. RecallNest `bot-ops` 记忆

## 群聊共享上下文规则

shared-context 只在群聊中启用：
- Telegram chatId > 0 = 私聊，< 0 = 群聊
- 新功能上线前必须同时测试私聊和群聊两个场景
