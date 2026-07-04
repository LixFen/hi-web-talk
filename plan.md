# Plan: Harness-Managed Tool Context & Multimodal Injection

## 1. Concepts

### 架构分层

```
Block 层（前端可见）      用户输入 → 最终 LLM 输出
   ↑
Harness 层（内部消息链）  用户输入 → [LLM↔Tool ↔ Harness 注入]*N → 最终 LLM 输出
   ↑
API 层（发给 LLM）       剥离 source 等内部字段后的纯 API 消息
```

### 内部消息协议

```js
// 所有内部消息携带 source 字段，用于 Harness 溯源/决策
{ role: "user",      source: "user",     content: "..." }     // 真实用户输入
{ role: "user",      source: "harness",  content: [...] }     // Harness 注入（图片等）
{ role: "tool",      source: "tool",     content: "...", tool_call_id: "..." }  // 工具返回
{ role: "assistant", ... }                                     // LLM 输出（不带 source）
```

### 消息清洗

每次发往 LLM 前，从内存消息中剥离 `source` 等内部字段。适配器层只见到标准 API 字段。

### contextPolicy（工具级别）

| 策略 | 含义 | 适用工具 |
|------|------|----------|
| `"preserve"` | 工具结果持久化，后续轮次可引用 | `draw_tikz`, `check_drawing` |
| `"discard"` | 工具结果仅当前轮有效 | `web_search` |

### 持久化

Harness 中间过程（含注入的图片等）存入 **block.meta.harness** 段，而非独立 block。
`block.prompt` / `block.response` 保持不变（前端可见层）。

---

## 2. 改动清单

### Phase 1: 工具注册表增强

**`server/services/tools/toolRegistry.js`**

```js
// 每个工具条目
{ definition, execute, contextPolicy }

// 新增接口
registerTool({ definition, execute, contextPolicy })  // contextPolicy 默认 "discard"
getToolContextPolicy(name)  // → "preserve" | "discard"
```

### Phase 2: 更新各工具注册

```js
// drawTikzTool.js
registerTool({ definition, execute, contextPolicy: "preserve" })
// 注：保持 pngBase64 在返回值中，移除只在 check_drawing 处使用的逻辑

// checkDrawingTool.js
registerTool({ definition, execute, contextPolicy: "preserve" })
// 移除对 toolResult.pngBase64 的特殊注入（由 harness 统一管理）

// webSearchTool.js
registerTool({ definition, execute, contextPolicy: "discard" })
```

### Phase 3: Harness 层 — baseLLMAdapter.js

**`server/services/providerAdapters/baseLLMAdapter.js`**

#### 3a. 消息注入（_callWithToolsLoop / _streamWithToolsLoop）

draw_tikz 成功后，对多模态模型注入 harness user message：

```js
// 紧接在 tool result push 之后
if (toolName === "draw_tikz" && toolResult.compiled && this.modelConfig.supportsMultimodal !== false && currentTikzPngBase64) {
  msgs.push({
    role: "user",
    source: "harness",
    content: [
      { type: "text", text: "[绘制的图形]" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${currentTikzPngBase64}` } }
    ]
  });
}
```

工具结果消息加上 `source: "tool"`：

```js
msgs.push({
  role: "tool",
  source: "tool",
  tool_call_id: toolCall.id || `call_${Date.now()}`,
  content: JSON.stringify(resultForLLM),
});
```

#### 3b. 收集 preserve 数据

循环结束后，收集本轮所有 `contextPolicy: "preserve"` 的工具结果：

```js
const preservedHarness = [];
if (currentTikzPngBase64) {
  preservedHarness.push({
    role: "user",
    content: [
      { type: "text", text: "[绘制的图形]" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${currentTikzPngBase64}` } }
    ]
  });
}
```

返回时附带 `preservedHarness`：

```js
return {
  reply, reasoning, usage, searchInfo, tikzInfo, responseId,
  preservedHarness,  // ← 新增
};
```

#### 3c. 消息清洗

每次调 LLM 前，从 msgs 中剥离内部字段：

```js
function stripInternalFields(msgs) {
  return msgs.map(msg => {
    const { source, ...clean } = msg;
    return clean;
  });
}
```

调用处：

```js
// 发送前
const cleanMsgs = stripInternalFields(msgs);
const result = await this.collectStreamResult(
  await this.createStreamWithTools(cleanMsgs, tools),
  onChunk
);
```

### Phase 4: 持久化 — server/index.js

**`server/index.js`** DialogueBlock 创建处（~line 1429）

```js
meta: {
  providerType: result.providerType,
  model: result.model,
  responseId: result.responseId,
  ...(result.searchInfo && { search: result.searchInfo }),
  ...(result.tikzInfo && { tikz: result.tikzInfo }),
  ...(result.preservedHarness?.length && { harness: result.preservedHarness }),
}
```

`drawTikzTool.js` 的返回值已包含 `pngBase64`，通过 `tikzInfo` 间接保留：
（`baseLLMAdapter.js` 中 `tikzInfo` 当前未存 `pngBase64`，需补充）

```js
// baseLLMAdapter.js, draw_tikz 处理块
tikzInfo = {
  code: toolResult.tikzCode,
  svg: toolResult.svg,
  compiled: true,
  pngBase64: toolResult.pngBase64,  // ← 新增
};
```

### Phase 5: 上下文重建 — server/index.js

**`server/index.js`** providerMessages 构建处（~line 1353-1364）

```js
// 在组装 providerMessages 后，对多模态模型注入 harness 消息
let providerMessages = [
  ...context.messages,
  { role: "user", content: normalizedPrompt },
];

if (selectedModel.supportsMultimodal !== false) {
  providerMessages = injectHarnessContext(providerMessages, context.chainBlocks);
}
// 后续的 resolveAttachmentMessages / downgradeMessagesForModel 不变
```

辅助函数 `injectHarnessContext`：

```js
function injectHarnessContext(messages, chainBlocks) {
  // 在历史消息中找到 assistant 消息对应的 block，
  // 若该 block 有 preserved harness 数据，在其后注入
  const result = [];
  let blockIdx = 0;

  for (const msg of messages) {
    result.push(msg);
    if (msg.role === "assistant" && blockIdx < chainBlocks.length) {
      const block = chainBlocks[blockIdx];
      const harness = block.meta?.harness;
      if (harness?.length) {
        for (const h of harness) {
          result.push({
            role: h.role,
            source: "harness",
            content: h.content,
          });
        }
      }
      blockIdx++;
    } else if (msg.role === "user" && blockIdx < chainBlocks.length) {
      // block 链中 user message 与 assistant message 成对出现
      // 只计数不注入
    }
  }
  return result;
}
```

### Phase 6: 发送清洗（适配器层）

适配器层无需改动。`source` 字段在 `baseLLMAdapter.js` 中已通过 `stripInternalFields` 剥离，
`role`/`content`/`tool_calls` 等标准字段保持不变。

如果适配器有个别直接遍历消息对象的，确保它们只提取已知字段。

### Phase 7: 前端思考面板增强（后续可迭代）

**当前现状：** 思考面板展示 `block.reasoning`（markdown 文本）

**目标：** 思考面板展示 Harness 完整中间过程，包括：
- tool_call 请求（哪个工具，什么参数）
- tool_result（结构化展示）
- Harness 注入消息（图片缩略图预览）

**实现方式（独立迭代，不在本计划首期范围）：**

```js
// block.meta.harness 中存储的中间过程
// 前端 ReasoningPanel 读取并渲染
```

---

## 3. 文件变更汇总

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `server/services/tools/toolRegistry.js` | 修改 | 新增 `contextPolicy` 支持与 `getToolContextPolicy` |
| `server/services/tools/drawTikzTool.js` | 修改 | 注册参数加 `contextPolicy: "preserve"` |
| `server/services/tools/checkDrawingTool.js` | 修改 | 注册参数加 `contextPolicy: "preserve"`；移除多模态特殊注入逻辑 |
| `server/services/tools/webSearchTool.js` | 修改 | 注册参数加 `contextPolicy: "discard"` |
| `server/services/providerAdapters/baseLLMAdapter.js` | 修改 | 3a 注入 harness 消息；3b 收集 preserve 数据；3c 消息清洗 |
| `server/index.js` | 修改 | Phase 4 持久化 harness 到 meta；Phase 5 上下文重建 |

---

## 4. 验证清单

- [ ] `draw_tikz` 成功后，多模态模型的 msgs 中包含 `{role: "user", source: "harness", content: [text, image_url]}`
- [ ] 同一轮循环内，LLM 再调用时能收到图片（可自行修正绘制）
- [ ] `check_drawing` 不再向 tool result 注入 `pngBase64`（图片已在 harness 消息中）
- [ ] 纯文本模型不注入 harness 消息
- [ ] `source` 字段在发往 LLM 前被剥离
- [ ] `block.meta.harness` 存储了 preserve 数据
- [ ] 后续轮次从 `block.meta.harness` 重建 harness 消息，注入 context
- [ ] 前端消息列表不受影响（`buildChainChatMessages` 不涉及 `meta.harness`）
- [ ] `web_search` 结果不持久化
