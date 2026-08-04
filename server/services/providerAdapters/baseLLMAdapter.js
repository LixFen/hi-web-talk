import { getToolExecutor } from "../tools/toolRegistry.js";

/**
 * Strip internal-only fields before sending messages to the LLM provider.
 * Currently strips `source` (harness-internal tracking field).
 */
function stripInternalFields(msgs) {
  return msgs.map((msg) => {
    const { source, ...clean } = msg;
    return clean;
  });
}

const MAX_TOOL_ROUNDS = 10;

/**
 * 抽象基类：统一 LLM Adapter 的公共逻辑
 *
 * 子类只需实现 doCall(messages) 和 doStream(messages, onChunk)，
 * 返回值构造、重试、凭证/配置访问由基类提供。
 *
 * 新增：callWithTools / streamWithTools 支持 tool calling 循环。
 */
export class BaseLLMAdapter {
  constructor(modelConfig, credential) {
    this.modelConfig = modelConfig;
    this.credential = credential;
  }

  // ── 公开入口（无 tool calling，向后兼容） ──

  /**
   * 统一调用入口（含 5xx 指数退避重试）
   */
  async call({ messages, signal, toolContext }) {
    return this.withRetry(() => this.doCall(messages, signal, toolContext));
  }

  /**
   * 统一流式入口
   */
  async stream({ messages, onChunk, signal, toolContext }) {
    return this.doStream(messages, onChunk, signal, toolContext);
  }

  // ── 公开入口（含 tool calling 循环） ──

  /**
   * 调用入口，含 tool calling 循环
   * @param {Object} params
   * @param {Array} params.messages
   * @param {Array} params.tools - 工具定义列表
   * @param {Function} params.onToolEvent - 工具事件回调 ({ type, toolCall, result, toolName, sources })
   * @returns {Promise<Object>} 标准化结果，包含 reasoning 数组和 searchInfo
   */
  async callWithTools({ messages, tools, onToolEvent, signal, toolContext }) {
    if (!tools || tools.length === 0) {
      const result = await this.call({ messages, signal, toolContext });
      return { ...result, reasoning: wrapReasoning(result.reasoning), searchInfo: null };
    }
    return this.withRetry(() => this._callWithToolsLoop(messages, tools, onToolEvent, signal, toolContext));
  }

  /**
   * 流式入口，含 tool calling 循环
   * @param {Object} params
   * @param {Array} params.messages
   * @param {Array} params.tools
   * @param {Function} params.onChunk
   * @param {Function} params.onToolEvent
   * @returns {Promise<Object>}
   */
  async streamWithTools({ messages, tools, onChunk, onToolEvent, signal, toolContext }) {
    if (!tools || tools.length === 0) {
      const result = await this.doStream(messages, onChunk, signal, toolContext);
      return { ...result, reasoning: wrapReasoning(result.reasoning), searchInfo: null };
    }
    return this._streamWithToolsLoop(messages, tools, onChunk, onToolEvent, signal, toolContext);
  }

  // ── 子类实现 ──

  /**
   * 子类实现：非流式调用
   */
  async doCall(_messages, _signal, _toolContext) {
    throw new Error("doCall() not implemented");
  }

  /**
   * 子类实现：流式调用
   */
  async doStream(_messages, _onChunk, _signal, _toolContext) {
    throw new Error("doStream() not implemented");
  }

  /**
   * 子类实现：带 tools 的非流式调用
   * 默认回退到 doCall（不传 tools）
   */
  async doCallWithTools(messages, _tools, signal, toolContext) {
    return this.doCall(messages, signal, toolContext);
  }

  /**
   * 子类实现：带 tools 的流式调用
   * 默认回退到 doStream（不传 tools）
   */
  async doStreamWithTools(messages, _tools, onChunk, signal, toolContext) {
    return this.doStream(messages, onChunk, signal, toolContext);
  }

  /**
   * 子类实现：从流式响应中收集完整结果（含 tool_calls）
   * 返回 { reply, reasoning, usage, toolCalls, message }
   */
  async collectStreamResult(_stream, _onChunk) {
    throw new Error("collectStreamResult() not implemented");
  }

  // ── Tool Calling 循环（核心逻辑） ──

  async _callWithToolsLoop(messages, tools, onToolEvent, signal, toolContext) {
    let msgs = [...messages];
    let totalUsage = { input: 0, output: 0, total: 0 };
    const reasoningParts = [];
    const searchInfo = { used: false, queries: [], sources: [] };
    let tikzInfo = null;
    let currentTikzCode = null;
    let currentTikzSvg = null;
    let currentTikzPngBase64 = null;
    let tikzAttempts = 0;
    const preservedArtifacts = [];
    let llmCalls = 0;

    while (true) {
      throwIfAborted(signal);
      llmCalls++;

      if (llmCalls > MAX_TOOL_ROUNDS) {
        throw new Error(`Tool calling loop exceeded maximum of ${MAX_TOOL_ROUNDS} rounds`);
      }

      // Strip internal fields before sending to provider
      const cleanMsgs = stripInternalFields(msgs);
      const result = await this.withRetry(() =>
        this.doCallWithTools(cleanMsgs, tools, signal, toolContext)
      );

      totalUsage = addUsage(totalUsage, result.usage);

      if (result.reasoning && result.reasoning.trim()) {
        reasoningParts.push({
          round: reasoningParts.length + 1,
          content: result.reasoning.trim(),
          type: "thinking",
        });
      }

      if (!result.toolCalls || result.toolCalls.length === 0) {
        return {
          reply: result.reply,
          reasoning: reasoningParts,
          usage: totalUsage,
          searchInfo: searchInfo.used ? { ...searchInfo, llmCalls } : null,
          tikzInfo,
          responseId: result.responseId,
          preservedArtifacts,
        };
      }

      msgs.push(result.message);

      for (const toolCall of result.toolCalls) {
        const toolName = toolCall.function?.name || toolCall.name;
        const toolArgs = parseToolArgs(toolCall);
        const executor = getToolExecutor(toolName);

        onToolEvent?.({ type: "tool_start", toolName, arguments: toolArgs });

        if (toolName === "web_search") {
          const query = toolArgs?.query || "";
          reasoningParts.push({
            round: reasoningParts.length + 1,
            content: `> 🔍 **联网搜索** — ${query}`,
            type: "tool",
          });
        }

        let rawResult;
        if (executor) {
          try {
            rawResult = await executor(toolArgs, { signal, toolContext });
          } catch (err) {
            if (err?.name === "AbortError") throw err;
            rawResult = { toolResult: { error: err.message }, artifacts: [] };
          }
        } else {
          rawResult = { toolResult: { error: `Unknown tool: ${toolName}` }, artifacts: [] };
        }

        // Destructure: tools now return { toolResult, artifacts[] }
        const { toolResult = rawResult, artifacts = [] } = rawResult || {};

        // ── Artifact-driven processing ──
        for (const artifact of artifacts) {
          switch (artifact.type) {
            case "image":
              if (this.modelConfig.supportsMultimodal !== false) {
                msgs.push({
                  role: "user",
                  source: "harness",
                  content: [
                    { type: "text", text: artifact.label || "[图]" },
                    { type: "image_url", image_url: { url: `data:${artifact.mime};base64,${artifact.data}` } },
                  ],
                });
              }
              if (artifact.contextPolicy === "preserve") {
                preservedArtifacts.push(artifact);
              }
              break;
          }
        }

        // ── Response metadata collection (tool-name based, for frontend) ──
        if (toolName === "web_search" && toolResult.sources) {
          if (toolResult.query) searchInfo.queries.push(toolResult.query);
          const startIdx = searchInfo.sources.length;
          searchInfo.sources.push(
            ...toolResult.sources.map((s, i) => ({
              citationId: startIdx + i + 1,
              title: s.title,
              url: s.url,
              snippet: s.snippet,
            })),
          );
        }

        if (toolName === "draw_tikz" && toolResult.compiled) {
          currentTikzCode = toolResult.tikzCode;
          const imageArtifact = artifacts.find((a) => a.type === "image");
          currentTikzSvg = imageArtifact?.meta?.svg || null;
          currentTikzPngBase64 = imageArtifact?.data || null;
          tikzAttempts++;
          tikzInfo = {
            code: toolResult.tikzCode,
            svg: currentTikzSvg,
            compiled: true,
          };
        }

        if (toolName === "check_drawing") {
          if (!currentTikzSvg) {
            toolResult.error = "暂无绘制结果，请先调用 draw_tikz";
          } else {
            tikzInfo = {
              code: currentTikzCode,
              svg: currentTikzSvg,
              compiled: true,
              verified: true,
              verifyAttempts: tikzAttempts,
            };
          }
        }

        if (toolName === "draw_tikz") {
          reasoningParts.push({
            round: reasoningParts.length + 1,
            content: toolResult.compiled
              ? "> 🎨 **绘制 TikZ 图形**"
              : "> ❌ **TikZ 编译失败**",
            type: "tool",
          });
        }

        if (toolName === "check_drawing") {
          reasoningParts.push({
            round: reasoningParts.length + 1,
            content: currentTikzSvg
              ? "> ✅ **TikZ 图形已检查**"
              : "> ❌ **暂无可检查的绘制结果**",
            type: "tool",
          });
        }

        onToolEvent?.({
          type: "tool_result",
          toolName,
          result: toolResult,
          sources: toolResult.sources,
        });

        msgs.push({
          role: "tool",
          tool_call_id: toolCall.id || `call_${Date.now()}`,
          content: JSON.stringify(toolResult),
        });
      }
    }
  }

  async _streamWithToolsLoop(messages, tools, onChunk, onToolEvent, signal, toolContext) {
    let msgs = [...messages];
    let totalUsage = { input: 0, output: 0, total: 0 };
    const reasoningParts = [];
    const searchInfo = { used: false, queries: [], sources: [] };
    let tikzInfo = null;
    let currentTikzCode = null;
    let currentTikzSvg = null;
    let currentTikzPngBase64 = null;
    let tikzAttempts = 0;
    const preservedArtifacts = [];
    let llmCalls = 0;

    while (true) {
      throwIfAborted(signal);
      llmCalls++;

      if (llmCalls > MAX_TOOL_ROUNDS) {
        throw new Error(`Tool calling loop exceeded maximum of ${MAX_TOOL_ROUNDS} rounds`);
      }

      onChunk?.({ type: "reasoning_round", round: reasoningParts.length + 1, reasoningDelta: "" });

      // Strip internal fields before sending to provider
      const cleanMsgs = stripInternalFields(msgs);
      const result = await this.collectStreamResult(
        await this.createStreamWithTools(cleanMsgs, tools, signal, toolContext),
        onChunk,
        onChunk,
      );

      totalUsage = addUsage(totalUsage, result.usage);

      if (result.reasoning && result.reasoning.trim()) {
        const roundNum = reasoningParts.length + 1;
        reasoningParts.push({
          round: roundNum,
          content: result.reasoning.trim(),
          type: "thinking",
        });
      }

      if (!result.toolCalls || result.toolCalls.length === 0) {
        return {
          reply: result.reply,
          reasoning: reasoningParts,
          usage: totalUsage,
          searchInfo: searchInfo.used ? { ...searchInfo, llmCalls } : null,
          tikzInfo,
          responseId: result.responseId,
          preservedArtifacts,
        };
      }

      msgs.push(result.message);

      for (const toolCall of result.toolCalls) {
        const toolName = toolCall.function?.name || toolCall.name;
        const toolArgs = parseToolArgs(toolCall);
        const executor = getToolExecutor(toolName);

        onToolEvent?.({ type: "tool_start", toolName, arguments: toolArgs });
        onChunk?.({ type: "tool_start", toolName, arguments: toolArgs });

        if (toolName === "web_search") {
          const query = toolArgs?.query || "";
          const roundNum = reasoningParts.length + 1;
          const reasoningContent = `> 🔍 **联网搜索** — ${query}`;
          reasoningParts.push({ round: roundNum, content: reasoningContent, type: "tool" });
          onChunk?.({ type: "reasoning_round", round: roundNum, reasoningDelta: reasoningContent });
        }

        let rawResult;
        if (executor) {
          try {
            rawResult = await executor(toolArgs, { signal, toolContext });
          } catch (err) {
            if (err?.name === "AbortError") throw err;
            rawResult = { toolResult: { error: err.message }, artifacts: [] };
          }
        } else {
          rawResult = { toolResult: { error: `Unknown tool: ${toolName}` }, artifacts: [] };
        }

        // Destructure: tools now return { toolResult, artifacts[] }
        const { toolResult = rawResult, artifacts = [] } = rawResult || {};

        // ── Artifact-driven processing ──
        for (const artifact of artifacts) {
          switch (artifact.type) {
            case "image":
              if (this.modelConfig.supportsMultimodal !== false) {
                msgs.push({
                  role: "user",
                  source: "harness",
                  content: [
                    { type: "text", text: artifact.label || "[图]" },
                    { type: "image_url", image_url: { url: `data:${artifact.mime};base64,${artifact.data}` } },
                  ],
                });
              }
              if (artifact.contextPolicy === "preserve") {
                preservedArtifacts.push(artifact);
              }
              break;
          }
        }

        // ── Response metadata collection (tool-name based, for frontend) ──
        if (toolName === "web_search" && toolResult.sources) {
          searchInfo.used = true;
          if (toolResult.query) searchInfo.queries.push(toolResult.query);
          const startIdx = searchInfo.sources.length;
          searchInfo.sources.push(
            ...toolResult.sources.map((s, i) => ({
              citationId: startIdx + i + 1,
              title: s.title,
              url: s.url,
              snippet: s.snippet,
            })),
          );
        }

        if (toolName === "draw_tikz" && toolResult.compiled) {
          currentTikzCode = toolResult.tikzCode;
          const imageArtifact = artifacts.find((a) => a.type === "image");
          currentTikzSvg = imageArtifact?.meta?.svg || null;
          currentTikzPngBase64 = imageArtifact?.data || null;
          tikzAttempts++;
          tikzInfo = {
            code: toolResult.tikzCode,
            svg: currentTikzSvg,
            compiled: true,
          };
        }

        if (toolName === "check_drawing") {
          if (!currentTikzSvg) {
            toolResult.error = "暂无绘制结果，请先调用 draw_tikz";
          } else {
            tikzInfo = {
              code: currentTikzCode,
              svg: currentTikzSvg,
              compiled: true,
              verified: true,
              verifyAttempts: tikzAttempts,
            };
          }
        }

        if (toolName === "draw_tikz") {
          reasoningParts.push({
            round: reasoningParts.length + 1,
            content: toolResult.compiled
              ? "> 🎨 **绘制 TikZ 图形**"
              : "> ❌ **TikZ 编译失败**",
            type: "tool",
          });
          onChunk?.({
            type: "reasoning_round",
            round: reasoningParts.length,
            reasoningDelta: reasoningParts[reasoningParts.length - 1].content,
          });
        }

        if (toolName === "check_drawing") {
          reasoningParts.push({
            round: reasoningParts.length + 1,
            content: currentTikzSvg
              ? "> ✅ **TikZ 图形已检查**"
              : "> ❌ **暂无可检查的绘制结果**",
            type: "tool",
          });
          onChunk?.({
            type: "reasoning_round",
            round: reasoningParts.length,
            reasoningDelta: reasoningParts[reasoningParts.length - 1].content,
          });
        }

        onToolEvent?.({
          type: "tool_result",
          toolName,
          result: toolResult,
          sources: toolResult.sources,
        });
        onChunk?.({
          type: "tool_result",
          toolName,
          engine: toolResult.engine,
          sources: toolResult.sources?.map((s) => ({
            title: s.title,
            url: s.url,
            snippet: s.snippet,
          })),
          svg: toolName === "draw_tikz" ? currentTikzSvg ?? null : undefined,
          compiled: toolName === "draw_tikz" ? toolResult.compiled ?? false : undefined,
          error: toolName === "draw_tikz" ? toolResult.error ?? null : undefined,
        });

        msgs.push({
          role: "tool",
          tool_call_id: toolCall.id || `call_${Date.now()}`,
          content: JSON.stringify(toolResult),
        });
      }
    }
  }

  // ── 工具方法 ──

  /**
   * 5xx 指数退避重试（最多 maxAttempts 次）
   */
  async withRetry(fn, maxAttempts = 3) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = err.status || err.statusCode || err.response?.status;
        const isRetryable = status && status >= 500;
        if (attempt === maxAttempts - 1 || !isRetryable) {
          throw err;
        }
        const delayMs = 1000 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * 标准化返回值构造
   */
  buildResult({ reply, reasoning, usage, responseId }) {
    return {
      reply: (reply || "").trim(),
      reasoning: (reasoning || "").trim(),
      usage: usage || { input: 0, output: 0, total: 0 },
      provider: this.modelConfig.providerType,
      providerType: this.modelConfig.providerType,
      model: this.modelConfig.modelName,
      responseId: responseId ?? null,
    };
  }
}

// ── 工具函数 ──

function addUsage(a, b) {
  return {
    input: (a.input || 0) + (b.input || 0),
    output: (a.output || 0) + (b.output || 0),
    total: (a.total || 0) + (b.total || 0),
  };
}

function parseToolArgs(toolCall) {
  const raw =
    toolCall.function?.arguments || toolCall.input || "{}";
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw || {};
}

function wrapReasoning(reasoning) {
  if (!reasoning) return [];
  if (Array.isArray(reasoning)) return reasoning;
  if (typeof reasoning === "string" && reasoning.trim()) {
    return [{ round: 1, content: reasoning.trim(), type: "thinking" }];
  }
  return [];
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("回复已取消。");
    error.name = "AbortError";
    throw error;
  }
}
