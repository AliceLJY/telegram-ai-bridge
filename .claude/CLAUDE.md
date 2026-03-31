# telegram-ai-bridge 运维规则

## 第一步永远是读手册

任何运维操作开始前，必须先读：
1. `~/Documents/运维手册/操作指南.md` — 五 bot 架构、配置目录
2. RecallNest `bot-ops` 记忆

## A2A / 跨 bot 功能规则

跨 bot 通信（A2A 广播、shared-context）只能在群聊中启用：
- 出站和入站两端都必须过滤私聊
- Telegram chatId > 0 = 私聊，< 0 = 群聊
- 新功能上线前必须同时测试私聊和群聊两个场景

## PR 测试门禁

A2A PR Stage 3 测试是硬性门禁，不可跳过：
1. Discord 回归
2. A2A live 消息
3. 核心功能容器内 live 验证
4. 用户明确确认

Stage 3 默认走 WebChat（`http://127.0.0.1:18795/`）+ Playwright MCP 自动化，不让用户手动去 Discord 操作。
