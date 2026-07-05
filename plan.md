# Plan: Artifact-Driven Harness for Tool Loop & Multimodal Context

> **设计原则：Harness 永远不关心"哪个 Tool"，只关心"产生了什么 Artifact"。**
>
> Tool 可以不断增加。Harness 的代码不应该因为增加 Tool 而修改。
> Harness 只需要认识 `image`、`audio`、`file`、`pdf` … 而不是 `draw_tikz`、`draw_mermaid`、`python_plot`。

> **任何需要跨轮次继续使用的数据，都应该提升为 Artifact；ToolResult 默认只属于当前 Tool Loop。**
>
> 图片、CSV、PDF、浏览器截图 → Artifact。编译成功、耗时、HTTP 状态码 → ToolResult。

## 总流程图

```
User
  │
  ▼
LLM
  │
  ├── (无 tool_call) ──→ Final Response ──→ Block
  │
  └── tool_call
        │
        ▼
      Tool
        │
        ▼
      { toolResult, artifacts[] }
        │
        ▼
      Harness  ←  参与 Tool Loop，不是后处理器
        │
        ├── toolResult → Tool Message → LLM
        │
        ├── Artifact → Inject（当前轮转 Harness Message）
        │     │
        │     ├── type=image + 多模态 → user message 带图片
        │     └── type=... → 后续扩展
        │
        ├── Artifact → Persist（contextPolicy=preserve → block.meta.artifacts）
        │
        └── 循环 → LLM（继续推理，看到注入的消息+工具结果）
              │
              └── ...
```

---

## 用户视角的 Block

Block 是用户看到的最小对话单位：

```
┌─────────────────────────────────────┐
│  用户消息（block.prompt）            │
│  ─────────────────────────────────   │
│  [▼ 思考过程]  ← 折叠，展示 reasoning │
│  ─────────────────────────────────   │
│  助手回复（block.response）          │
│  ─────────────────────────────────   │
│  [📄 来源 1] [📄 来源 2]  ← search  │
│  [🖼 查看图形]            ← tikz     │
│  [▶ 继续] [↻ 重试]       ← 操作     │
└─────────────────────────────────────┘
```

- 用户看到的只有 **一轮输入 + 一轮输出**
- 思考面板展开后也只显示 LLM 的推理文本（reasoning），**不暴露内部消息链**
- 工具产物 UI（搜索卡片、TikZ 预览按钮）由 `block.meta` 驱动，与 Harness 无关
- 中间 Harness 管理了多少轮 LLM↔Tool 循环、注入了多少条消息，对用户完全透明

这是"Block 层"与"Harness 层"分离的根本原因。

---

## 数据生命周期

每类数据在三个维度上有不同策略：

| 数据 | 持久化（DB） | 清洗（发 LLM 前） | 展示（前端） | 生成时机 |
|------|-------------|-------------------|-------------|---------|
| `block.prompt` | ✅ | — | ✅ 用户消息 | 用户输入 |
| `block.response` | ✅ | — | ✅ 助手回复 | 循环结束 |
| `block.reasoning` | ✅ | — | ✅ 思考面板 | 循环中累积 |
| `block.meta.search` | ✅ | — | ✅ 来源卡片 | 循环中收集（web_search 结果） |
| `block.meta.tikz` | ✅ | — | ✅ TikZ 预览按钮 | 循环中收集（draw_tikz 结果） |
| `block.meta.artifacts` | ✅ | — | ❌ 不直接展示，供 ContextBuilder 重建 | 循环中收集（preserved artifacts） |
| **消息上的 `source`** | ❌ 仅内存 | ✅ `stripInternalFields()` 剥离 | ❌ | 构建 providerMessages 时附加 |
| **Harness Message** | ❌ 不存，存的是 Artifact | ✅ 发 LLM 前剥离 source | ❌ | 运行时由 Harness/ContextBuilder 构造 |
| **tool_calls**（assistant 消息中） | ❌ 当前不存 | ✅ 部分 Provider 需要保留 | ❌（<br>仅 streaming 时通过 tool_start 事件提示） | LLM 返回 |
| **tool message content** | ❌ 当前不存（仅 `meta` 存摘要） | ✅ | ❌ | 工具执行后 |

### 维度说明

**持久化**：写入 SQLite 的数据。服务器重启后不丢失。每个 block 是独立记录。

**清洗**：发往 LLM API 前从消息对象中移除的字段。防止 Provider 收到不认识的字段导致报错。

**展示**：前端聊天界面渲染的数据。未列出的字段（如 artifacts）不会传到前端。

### 设计原则

```
Artifact           → 持久化 → Provider 无关
Harness Message    → 不持久化 → 运行时按 Provider 格式重建
source             → 不持久化 → 发 LLM 前清洗
meta.tikz/search   → 持久化 → 纯前端展示，与 LLM 上下文无关
```

### Harness 与 前端的边界

前端展示的数据（search, tikz）虽然也在循环中收集，但它们**不是 Harness 核心逻辑**。Harness 只负责：

1. Inject（Artifact → Harness Message → msgs）
2. Persist（Artifact → block.meta.artifacts）
3. Rebuild（block.meta.artifacts → Harness Message → providerMessages）

search/tikz 的收集是**响应元数据收集**，与 artifact 处理并行但不耦合：

```js
for (const artifact of result.artifacts || []) {
  // Harness 核心：artifact-driven
  switch (artifact.type) { ... }
}

// 响应元数据收集：可保留工具名判断，与 Harness 核心无关
collectResponseMetadata(toolName, toolResult);
```

---

## 1. 核心概念

### 1.1 Harness 是 Tool Loop 的参与者

Tool Loop 不是简单的"LLM → 工具 → LLM"。Harness 在每一轮中承担：

```
LLM 返回 tool_calls
  │
  ▼
执行 Tool
  │
  ▼
Tool 返回 { toolResult, artifacts[] }
  │
  ▼
Harness:
  1. toolResult → Tool Message（推送回 msgs）
  2. artifacts → Inject（多模态图片等转成 Harness Message 推入 msgs）
  3. artifacts → Persist（contextPolicy=preserve 收集到 preservedArtifacts）
  │
  ▼
LLM 继续推理（msgs 中包含了注入的图片/产物）
```

Harness **不是** Tool 执行后的后处理阶段，而是每一轮 Tool Loop 的核心编排者。

### 1.2 Artifact 生命周期（三阶段）

```
Tool 执行
  │
  ▼
Artifact
  │
  ├── ① Inject（当前轮）
  │     将 artifact 转为 Harness Message 注入 msgs，
  │     让 LLM 在当前轮就能看到图片/产物。
  │     e.g. image → { role: "user", source: "harness", content: [text, image_url] }
  │
  ├── ② Persist（持久化）
  │     根据 contextPolicy 决定是否存入 block.meta.artifacts。
  │     preserve → 存入 DB
  │     discard  → 丢弃
  │
  └── ③ Rebuild（下一轮恢复）
         ContextBuilder 读取 block.meta.artifacts，
         重建 Harness Message 注入 providerMessages。
```

三个阶段各自独立：

| 阶段 | 时机 | 条件 | 产出 |
|------|------|------|------|
| Inject | 当前 Tool Loop 内 | artifact.type 有对应处理逻辑 | Harness Message → msgs |
| Persist | 当前轮结束后 | contextPolicy === "preserve" | block.meta.artifacts |
| Rebuild | 后续轮构建上下文 | block.meta.artifacts 存在 | Harness Message → providerMessages |

### 1.3 toolResult vs Artifact

```
                   发给 LLM     持久化        用途
toolResult         是           不保留        告诉 LLM 工具执行的结构化结果，当前循环结束后丢弃
Artifact           Harness 决定  preserve 时存  图片/文件/音频等可复用产物，跨轮次使用
```

**核心原则：Tool Result 默认仅用于当前 Tool Loop，不参与后续上下文。**

若某部分数据需要跨轮次使用，Tool 必须将其作为 `Artifact` 返回，而不是依赖 `toolResult` 长期保留。

```js
// ❌ 错误：把数据塞进 toolResult 指望后续轮次能用
{
  toolResult: {
    imageBase64: "....",  // 不会被保留
    tikzCode: "...",
  }
}

// ✅ 正确：通过 Artifact 声明跨轮次用途
{
  toolResult: {
    tikzCode: "...",      // 仅当前轮 LLM 需要看到
    compiled: true,
  },
  artifacts: [
    {
      type: "image",
      mime: "image/png",
      contextPolicy: "preserve",   // 明确声明需要保留
      data: "...base64...",
    }
  ]
}
```

这条规则确保：**只有显式声明为 Artifact 的数据才会被持久化和重建**，避免 Harness 对 toolResult 结构产生隐式依赖。

为什么要拆分：

```js
// drawTikzTool.js
{
  toolResult: {                    // → 作为 tool message content 发给 LLM
    tikzCode: "...",
    compiled: true,
  },
  artifacts: [                     // → ArtifactManager 处理
    {
      id: "art_xxx",              // 唯一 ID，供后续删除/更新/引用
      type: "image",
      mime: "image/png",
      contextPolicy: "preserve",   // Artifact 生命周期策略，非 Tool 生命周期
      label: "[绘制的图形]",
      data: "...base64...",
    }
  ]
}
```

**`id` 的设计意图**：一个 Block 可能产生多个 Artifact（图1、图2、CSV、PDF），未来需要删除/更新/引用某个特定 Artifact 时，`id` 是唯一的操作句柄。

LLM 需要结构化数据（代码、状态），Harness 需要多模态数据（图片 base64）。两种数据生命周期不同，拆分后各自清晰。

### 1.4 为什么持久化 Artifact 而非 Harness Message

```
Artifact（纯数据）
  │
  ├── OpenAI Message
  ├── Anthropic Message
  └── Gemini Message

数据库
  └── block.meta.artifacts（Provider 无关）
```

Artifact 是 Provider 无关的纯数据（type, mime, data），Harness Message 是运行时根据具体 Provider 的消息格式构造的。存 artifact 意味着：

- 切换 Provider 时无需迁移数据
- 新增 Provider 时无需修改持久化逻辑
- 未来可以支持更多产物类型（音频、PDF 等）

### 1.5 source 字段

```js
{ role: "user",      source: "user"     }  // 真实用户输入
{ role: "user",      source: "harness"  }  // Harness 注入
{ role: "tool",      source: "tool"     }  // 工具返回
{ role: "assistant"                       }  // LLM 输出（无 source）
```

- 仅 Harness 内部使用，用于追踪消息来源
- 发往 Provider 前统一 `stripInternalFields()` 剥离
- Provider API 永远不会见到 source

### 1.6 ContextBuilder 角色

```
block.meta.artifacts
  │
  ▼
ContextBuilder
  │
  ├── 遍历 chainBlocks
  ├── 读取每个 block 的 meta.artifacts
  ├── 按 artifact.type 重建 Harness Message
  └── 注入 providerMessages
```

目前 ContextBuilder 是 `server/index.js` 中 `injectArtifactMessages()` 函数。未来可独立为 `contextBuilderService.js` 的一部分。

### 1.7 ArtifactManager

Artifact 的三个动作（Inject、Persist、Rebuild）由同一组件 `ArtifactManager` 负责，而不是散落在 `baseLLMAdapter.js` 和 `server/index.js` 中。

```
Tool
  │
  ▼
{ toolResult, artifacts[] }
  │
  ▼
ArtifactManager
  ├── Inject → Harness Message → msgs（当前轮让 LLM 看到）
  ├── Persist → block.meta.artifacts（保存到数据库）
  └── Rebuild → providerMessages（下一轮恢复给 LLM）
```

初始实现中 ArtifactManager 是几个函数，未来可独立为类或服务：

```js
// 概念示意
const artifactManager = {
  inject(artifact, msgs, modelConfig) { /* artifact → Harness Message */ },
  persist(artifact) { /* 收集到 preservedArtifacts[] */ },
  rebuild(block, providerMessages, supportsMultimodal) { /* block.meta.artifacts → Harness Message */ },
};
```

**为什么需要 ArtifactManager：**

| 未来功能 | 归属 |
|----------|------|
| 压缩图片 | ArtifactManager.inject |
| Base64 → OSS URL | ArtifactManager.persist |
| 生成缩略图 | ArtifactManager.persist |
| 去重（同一图片多次出现） | ArtifactManager.inject |
| TTL 清理过期 Artifact | ArtifactManager.rebuild |
| 限制上下文窗口内的 Artifact 数量 | ArtifactManager.rebuild |

所有 Artifact 相关的逻辑都集中在 ArtifactManager 中，不散落在 Harness 的各个角落。

### 1.8 contextPolicy 是 Artifact 的生命周期策略

`contextPolicy` 描述的是 **Artifact 的生命周期**，而非 Tool 的生命周期。

| 策略 | 含义 | 适用场景 |
|------|------|----------|
| `discard` | 仅当前轮 | 搜索摘要、实时数据 |
| `preserve` | 持久化到 Block，每轮恢复 | 图片、绘图、用户上传文件 |
| `session` | 会话期内有效，不持久化到 DB | 临时计算结果 |
| `ttl` | 带过期时间的 preserve | 缓存类数据 |

初始实现只支持 `discard` 和 `preserve`，后续可按需扩展。

---

## 2. Harness 伪代码

### 2.1 当前轮 Inject（baseLLMAdapter.js）

```js
// 工具执行完毕后
const artifacts = result.artifacts || [];

for (const artifact of artifacts) {
  switch (artifact.type) {

    case "image":
      // Inject: 多模态模型 → 注入 user message 带图片
      if (this.modelConfig.supportsMultimodal !== false) {
        msgs.push({
          role: "user",
          source: "harness",
          content: [
            { type: "text", text: artifact.label || "[图]" },
            { type: "image_url", image_url: { url: `data:${artifact.mime};base64,${artifact.data}` } }
          ]
        });
      }
      // Persist: 收集到 preservedArtifacts
      if (artifact.contextPolicy === "preserve") {
        preservedArtifacts.push(artifact);
      }
      break;

    // 后续扩展: case "audio" / case "file" / ...
  }
}
```

**注意**：Harness 中不存在 `if (toolName === "draw_tikz")`。所有决策基于 `artifact.type`。

### 2.2 消息清洗

```js
function stripInternalFields(msgs) {
  return msgs.map(msg => {
    const { source, ...clean } = msg;
    return clean;
  });
}

// 每次发往 LLM 前
const cleanMsgs = stripInternalFields(msgs);
const result = await this.collectStreamResult(
  await this.createStreamWithTools(cleanMsgs, tools), onChunk
);
```

### 2.3 返回 preservedArtifacts

```js
// 循环结束后
return {
  reply, reasoning, usage, searchInfo, tikzInfo, responseId,
  preservedArtifacts,  // → server/index.js 存到 block.meta.artifacts
};
```

---

## 3. ContextBuilder：下一轮 Rebuild

```js
// server/index.js 中构建 providerMessages
function injectArtifactMessages(messages, chainBlocks, supportsMultimodal) {
  if (supportsMultimodal === false) return messages;

  const result = [];
  let blockIdx = 0;

  for (const msg of messages) {
    result.push(msg);
    if (msg.role !== "assistant") continue;

    const block = chainBlocks[blockIdx];
    const artifacts = block?.meta?.artifacts || [];
    for (const a of artifacts) {
      if (a.type === "image" && a.contextPolicy === "preserve") {
        result.push({
          role: "user",
          source: "harness",
          content: [
            { type: "text", text: a.label || "[这是上一轮绘制的图形]" },
            { type: "image_url", image_url: { url: `data:${a.mime};base64,${a.data}` } }
          ]
        });
      }
    }
    blockIdx++;
  }

  return result;
}
```

---

## 4. 改动清单

| 层 | 文件 | 改动 |
|----|------|------|
| Tool | `drawTikzTool.js` | 返回 `{ toolResult: { tikzCode, compiled }, artifacts: [{ type:"image", mime, contextPolicy:"preserve", data }] }` |
| Tool | `checkDrawingTool.js` | 返回 `{ toolResult: { isCorrect, tikzCode, notes } }`，无 artifacts |
| Tool | `webSearchTool.js` | 返回 `{ toolResult: { query, engine, sources }, artifacts: [] }` |
| Harness | `baseLLMAdapter.js` | 删除所有 `if (toolName === "...")` 的 artifact 关联代码；改为 `for artifact of artifacts` + switch on type；Inject + Persist；消息清洗 |
| Persist | `server/index.js` | `block.meta.artifacts = result.preservedArtifacts` |
| ContextBuilder | `server/index.js` | `injectArtifactMessages()` 在 providerMessages 中重建 Harness Message |

## 5. 不变领域

| 组件 | 说明 |
|------|------|
| `block.meta.tikz` | 前端 TikZ 预览不变（SVG / tikzCode 等） |
| `block.meta.search` | 搜索来源展示不变 |
| 前端 MessageList | 不感知 artifacts |
| `buildChainChatMessages()` | 不感知 artifacts |
| 各 Provider Adapter | 不感知 source（已在发送前剥离） |
| `toolRegistry.js` | 暂不需要 contextPolicy（contextPolicy 在 artifact 上，不在 tool 上） |
