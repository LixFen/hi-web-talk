import { getToolExecutor } from "../tools/toolRegistry.js";

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
  async call({ messages }) {
    return this.withRetry(() => this.doCall(messages));
  }

  /**
   * 统一流式入口
   */
  async stream({ messages, onChunk }) {
    return this.doStream(messages, onChunk);
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
  async callWithTools({ messages, tools, onToolEvent }) {
    if (!tools || tools.length === 0) {
      const result = await this.call({ messages });
      return { ...result, reasoning: wrapReasoning(result.reasoning), searchInfo: null };
    }
    return this.withRetry(() => this._callWithToolsLoop(messages, tools, onToolEvent));
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
  async streamWithTools({ messages, tools, onChunk, onToolEvent }) {
    if (!tools || tools.length === 0) {
      const result = await this.doStream(messages, onChunk);
      return { ...result, reasoning: wrapReasoning(result.reasoning), searchInfo: null };
    }
    return this._streamWithToolsLoop(messages, tools, onChunk, onToolEvent);
  }

  // ── 子类实现 ──

  /**
   * 子类实现：非流式调用
   */
  async doCall(_messages) {
    throw new Error("doCall() not implemented");
  }

  /**
   * 子类实现：流式调用
   */
  async doStream(_messages, _onChunk) {
    throw new Error("doStream() not implemented");
  }

  /**
   * 子类实现：带 tools 的非流式调用
   * 默认回退到 doCall（不传 tools）
   */
  async doCallWithTools(messages, _tools) {
    return this.doCall(messages);
  }

  /**
   * 子类实现：带 tools 的流式调用
   * 默认回退到 doStream（不传 tools）
   */
  async doStreamWithTools(messages, _tools, onChunk) {
    return this.doStream(messages, onChunk);
  }

  /**
   * 子类实现：从流式响应中收集完整结果（含 tool_calls）
   * 返回 { reply, reasoning, usage, toolCalls, message }
   */
  async collectStreamResult(_stream, _onChunk) {
    throw new Error("collectStreamResult() not implemented");
  }

  // ── Tool Calling 循环（核心逻辑） ──

  async _callWithToolsLoop(messages, tools, onToolEvent) {
    let msgs = [...messages];
    let totalUsage = { input: 0, output: 0, total: 0 };
    const reasoningParts = [];
    const searchInfo = { used: false, queries: [], sources: [] };
    let tikzInfo = null;
    let currentTikzCode = null;
    let currentTikzSvg = null;
    let currentTikzPngBase64 = null;
    let tikzAttempts = 0;
    let llmCalls = 0;

    while (true) {
      llmCalls++;

      if (llmCalls > MAX_TOOL_ROUNDS) {
        throw new Error(`Tool calling loop exceeded maximum of ${MAX_TOOL_ROUNDS} rounds`);
      }

      const result = await this.withRetry(() =>
        this.doCallWithTools(msgs, tools)
      );

      totalUsage = addUsage(totalUsage, result.usage);

      if (result.reasoning && result.reasoning.trim()) {
        reasoningParts.push({
          round: reasoningParts.length + 1,
          content: result.reasoning.trim(),
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
          const reasoningContent = `> 🔍 **联网搜索** — ${query}`;
          reasoningParts.push({
            round: reasoningParts.length + 1,
            content: reasoningContent,
          });
        }

        let toolResult;
        if (executor) {
          try {
            toolResult = await executor(toolArgs);
          } catch (err) {
            toolResult = { error: err.message };
          }
        } else {
          toolResult = { error: `Unknown tool: ${toolName}` };
        }

        if (toolName === "web_search" && toolResult.sources) {
          if (toolResult.query) searchInfo.queries.push(toolResult.query);
          const startIdx = searchInfo.sources.length;
          searchInfo.sources.push(
            ...toolResult.sources.map((s, i) => ({
              citationId: startIdx + i + 1,
              title: s.title,
              url: s.url,
              snippet: s.snippet,
            }))
          );
        }

        if (toolName === "draw_tikz" && toolResult.compiled) {
          currentTikzCode = toolResult.tikzCode;
          currentTikzSvg = toolResult.svg;
          currentTikzPngBase64 = toolResult.pngBase64;
          tikzAttempts++;
          tikzInfo = {
            code: toolResult.tikzCode,
            svg: toolResult.svg,
            compiled: true,
          };
        }

        if (toolName === "check_drawing") {
          if (!currentTikzSvg) {
            toolResult = { isCorrect: false, error: "暂无绘制结果，请先调用 draw_tikz" };
          } else if (toolResult.isCorrect) {
            toolResult.svg = currentTikzSvg;
            if (this.modelConfig.supportsMultimodal !== false && currentTikzPngBase64) {
              toolResult.pngBase64 = currentTikzPngBase64;
            }
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
          });
        }

        if (toolName === "check_drawing") {
          reasoningParts.push({
            round: reasoningParts.length + 1,
            content: currentTikzSvg && toolResult.isCorrect
              ? "> ✅ **TikZ 图形已确认**"
              : "> ❌ **暂无可确认的绘制结果**",
          });
        }

        onToolEvent?.({
          type: "tool_result",
          toolName,
          result: toolResult,
          sources: toolResult.sources,
        });

        const resultForLLM = toolName === "draw_tikz" && toolResult.compiled
          ? { compiled: true, tikzCode: toolResult.tikzCode }
          : toolResult;

        msgs.push({
          role: "tool",
          tool_call_id: toolCall.id || `call_${Date.now()}`,
          content: JSON.stringify(resultForLLM),
        });
      }
    }
  }

  async _streamWithToolsLoop(messages, tools, onChunk, onToolEvent) {
    let msgs = [...messages];
    let totalUsage = { input: 0, output: 0, total: 0 };
    const reasoningParts = [];
    const searchInfo = { used: false, queries: [], sources: [] };
    let tikzInfo = null;
    let currentTikzCode = null;
    let currentTikzSvg = null;
    let currentTikzPngBase64 = null;
    let tikzAttempts = 0;
    let llmCalls = 0;

    while (true) {
      llmCalls++;

      if (llmCalls > MAX_TOOL_ROUNDS) {
        throw new Error(`Tool calling loop exceeded maximum of ${MAX_TOOL_ROUNDS} rounds`);
      }

      onChunk?.({ type: "reasoning_round", round: reasoningParts.length + 1, reasoningDelta: "" });

      const result = await this.collectStreamResult(
        await this.createStreamWithTools(msgs, tools),
        onChunk,
        onChunk
      );

      totalUsage = addUsage(totalUsage, result.usage);

      if (result.reasoning && result.reasoning.trim()) {
        const roundNum = reasoningParts.length + 1;
        reasoningParts.push({
          round: roundNum,
          content: result.reasoning.trim(),
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
          reasoningParts.push({ round: roundNum, content: reasoningContent });
          onChunk?.({ type: "reasoning_round", round: roundNum, reasoningDelta: reasoningContent });
        }

        let toolResult;
        if (executor) {
          try {
            toolResult = await executor(toolArgs);
          } catch (err) {
            toolResult = { error: err.message };
          }
        } else {
          toolResult = { error: `Unknown tool: ${toolName}` };
        }

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
            }))
          );
        }

        if (toolName === "draw_tikz" && toolResult.compiled) {
          currentTikzCode = toolResult.tikzCode;
          currentTikzSvg = toolResult.svg;
          currentTikzPngBase64 = toolResult.pngBase64;
          tikzAttempts++;
          tikzInfo = {
            code: toolResult.tikzCode,
            svg: toolResult.svg,
            compiled: true,
          };
        }

        if (toolName === "check_drawing") {
          if (!currentTikzSvg) {
            toolResult = { isCorrect: false, error: "暂无绘制结果，请先调用 draw_tikz" };
          } else if (toolResult.isCorrect) {
            toolResult.svg = currentTikzSvg;
            if (this.modelConfig.supportsMultimodal !== false && currentTikzPngBase64) {
              toolResult.pngBase64 = currentTikzPngBase64;
            }
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
            content: currentTikzSvg && toolResult.isCorrect
              ? "> ✅ **TikZ 图形已确认**"
              : "> ❌ **暂无可确认的绘制结果**",
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
          svg: toolName === "draw_tikz" ? toolResult.svg ?? null : undefined,
          compiled: toolName === "draw_tikz" ? toolResult.compiled ?? false : undefined,
          error: toolName === "draw_tikz" ? toolResult.error ?? null : undefined,
        });

        const resultForLLM = toolName === "draw_tikz" && toolResult.compiled
          ? { compiled: true, tikzCode: toolResult.tikzCode }
          : toolResult;

        msgs.push({
          role: "tool",
          tool_call_id: toolCall.id || `call_${Date.now()}`,
          content: JSON.stringify(resultForLLM),
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
    return [{ round: 1, content: reasoning.trim() }];
  }
  return [];
}
