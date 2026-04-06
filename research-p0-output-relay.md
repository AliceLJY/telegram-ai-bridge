# P0 Research: CC 输出图片/文件回传到 Telegram

## 1. 当前数据流总览

```
TG 用户消息 → bridge.js submitAndWait()
  → executor/direct.js streamTask()
    → adapters/claude.js streamQuery() → _runQuery()
      → Claude Agent SDK query() 
        → 流式 SDKMessage 事件
    → yield 简化事件给 bridge
  → bridge 消费事件 → progress 追踪 + 最终结果发回 TG
```

## 2. SDK 事件类型（完整列表）

Claude Agent SDK `query()` 返回 `AsyncGenerator<SDKMessage>`，SDKMessage 包含 22 种类型。

与图片/文件回传相关的：

| 类型 | type/subtype | 当前适配器处理 | 包含什么 |
|------|-------------|--------------|---------|
| SDKAssistantMessage | `assistant` | ✅ 提取 tool_use → progress，text → text | BetaMessage 内容块 |
| **SDKUserMessage** | `user` | ❌ 完全忽略 | **工具执行结果**（含 base64 图片） |
| **SDKFilesPersistedEvent** | `system/files_persisted` | ❌ 忽略 | **文件名 + file_id 列表** |
| SDKToolUseSummaryMessage | `tool_use_summary` | ❌ 忽略 | 工具摘要文字 |
| SDKResultMessage | `result` | ✅ 提取 success/text/cost | 最终文字结果（纯文本） |

## 3. 关键发现：被丢弃的数据

### 3.1 SDKUserMessage — 工具结果（最重要）

```typescript
type SDKUserMessage = {
  type: 'user';
  message: MessageParam;      // Anthropic API MessageParam
  parent_tool_use_id: string | null;  // 非 null = 工具结果
  tool_use_result?: unknown;  // 工具原始返回
  session_id: string;
};
```

当 CC 执行工具后，SDK 返回 `SDKUserMessage`：
- `message.content` 是 `ContentBlockParam[]`，可含 `ToolResultBlockParam`
- 每个 `ToolResultBlockParam` 的 `content` 可含 **text** 和 **image** (base64)
- **这是图片回传的主要数据来源**

CC 的截图工具（MCP take_screenshot）、图片分析等会在这里包含 base64 image data。

### 3.2 SDKFilesPersistedEvent — 文件持久化通知

```typescript
type SDKFilesPersistedEvent = {
  type: 'system';
  subtype: 'files_persisted';
  files: { filename: string; file_id: string; }[];
  failed: { filename: string; error: string; }[];
};
```

CC 创建/修改文件后可能发出。`filename` 包含路径信息。

### 3.3 tool_use 输入中的文件路径

当前 progress 事件已有 `toolName` + `input`，可从中提取：
- `Write` → `input.file_path`（新建文件）
- `Edit` → `input.file_path`（修改文件）
- `Bash` → `input.command`（可能产生文件，需 heuristic）

## 4. 当前适配器 (adapters/claude.js:207-263)

`_runQuery` 只处理三种 msg.type：
- `system` + `init` → session_init
- `assistant` → 提取 tool_use/text
- `result` → 最终结果

**完全不处理 `user` 类型（工具结果）和 `system/files_persisted`**

## 5. bridge.js 输出处理 (lines 1007-1028)

最终结果只走文字：
- 短文本 → `ctx.reply(resultText)` + quickReply 按钮
- 长文本 → `sendLong()` 按 4000 字符分段
- 无输出 → "无输出"
- 错误 → 错误文本

**没有 sendPhoto / sendDocument 能力。**

## 6. 实现方案

### Phase 1: 适配器层新增事件

在 `adapters/claude.js` `_runQuery()` 新增：

```javascript
// 捕获工具结果中的图片
if (msg.type === "user" && msg.parent_tool_use_id) {
  const content = msg.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      // ToolResultBlockParam 格式
      if (block.type === "tool_result" && Array.isArray(block.content)) {
        for (const part of block.content) {
          if (part.type === "image" && part.source?.data) {
            yield {
              type: "image",
              data: part.source.data,
              mediaType: part.source.media_type || "image/png",
              toolUseId: block.tool_use_id,
            };
          }
        }
      }
      // 直接是 image block（非嵌套在 tool_result 中）
      if (block.type === "image" && block.source?.data) {
        yield {
          type: "image",
          data: block.source.data,
          mediaType: block.source.media_type || "image/png",
        };
      }
    }
  }
}

// 捕获文件持久化事件
if (msg.type === "system" && msg.subtype === "files_persisted") {
  for (const f of msg.files) {
    yield { type: "file_persisted", filename: f.filename, fileId: f.file_id };
  }
}
```

### Phase 2: bridge.js 事件消费

event loop (~line 944) 新增收集器：

```javascript
const capturedImages = [];
const capturedFiles = [];

// 在 for await loop 内：
if (event.type === "image") {
  capturedImages.push(event);
}
if (event.type === "file_persisted") {
  capturedFiles.push(event);
}
```

### Phase 3: 输出发送

输出阶段 (~line 1007) 改造：

```javascript
// 1. 先发图片
for (const img of capturedImages) {
  const buf = Buffer.from(img.data, "base64");
  await ctx.replyWithPhoto(new InputFile(buf, `screenshot.${img.mediaType.split("/")[1] || "png"}`));
}

// 2. 发文件（只发图片/文档类，跳过代码文件）
const SEND_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".docx", ".xlsx"]);
for (const f of capturedFiles) {
  const ext = f.filename.slice(f.filename.lastIndexOf(".")).toLowerCase();
  if (SEND_EXTENSIONS.has(ext) && existsSync(f.filename)) {
    await ctx.replyWithDocument(new InputFile(f.filename));
  }
}

// 3. 长代码输出 → 文件附件
if (resultText && resultText.length > 4000) {
  const codeBlockMatch = resultText.match(/```(\w*)\n/);
  if (codeBlockMatch || resultText.length > 8000) {
    const ext = codeBlockMatch?.[1] || "txt";
    const buf = Buffer.from(resultText);
    await ctx.replyWithDocument(new InputFile(buf, `output.${ext}`));
    // 发摘要
    const summary = resultText.slice(0, 300) + `\n\n... (${resultText.length} 字符，完整内容见附件)`;
    await ctx.reply(summary);
  } else {
    await sendLong(ctx, resultText);
  }
} else if (resultText) {
  // 原有逻辑
}
```

## 7. 需要验证的假设

| # | 假设 | 验证方式 |
|---|------|---------|
| 1 | SDKUserMessage.message.content 包含 base64 image | 实测 take_screenshot，log 事件结构 |
| 2 | SDKFilesPersistedEvent 在 Write/Edit 后触发 | 实测，log 所有 system 事件 |
| 3 | grammy InputFile 接受 Buffer 直接发送 | 查 grammy 文档 |
| 4 | TG Bot API sendPhoto 限制 10MB | 文档确认 |
| 5 | Codex/Gemini 适配器需要类似处理 | P0 先只做 Claude，后续再做 |

## 8. 实施顺序

1. **Step 1**: adapters/claude.js — yield image/file_persisted 事件
2. **Step 2**: bridge.js event loop — 收集 capturedImages/capturedFiles
3. **Step 3**: bridge.js 输出 — sendPhoto/sendDocument
4. **Step 4**: sendLong 升级 — 长代码→文件附件+摘要
5. **Step 5**: progress.js — 截图工具图标
6. **Step 6**: 端到端测试

## 9. grammy 发送 API 参考

```javascript
import { InputFile } from "grammy";

// 发图片（Buffer）
await ctx.replyWithPhoto(new InputFile(buffer, "name.png"));

// 发文件（本地路径）
await ctx.replyWithDocument(new InputFile("/path/to/file.pdf"));

// 发文件（Buffer）
await ctx.replyWithDocument(new InputFile(buffer, "output.txt"));
```

## 10. 风险

- base64 图片可能很大（截图 1-5MB），buffer 占内存
- TG Bot API sendPhoto 限 10MB，sendDocument 限 50MB
- 高频工具调用可能产生大量图片，需要限制数量（如最多 5 张）
- 文件路径可能包含敏感信息（home 目录路径），发送前需脱敏或只发文件名
- Codex/Gemini 的事件格式不同，需分别处理
