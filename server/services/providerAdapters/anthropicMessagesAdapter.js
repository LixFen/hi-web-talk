import Anthropic from "@anthropic-ai/sdk";
import {
  formatTokenUsage,
  splitSystemMessage,
  convertMultimodalContentForClaude,
} from "./baseAdapter.js";
import { BaseLLMAdapter } from "./baseLLMAdapter.js";

/**
 * 将 OpenAI 格式的工具定义转换为 Anthropic 格式
 */
function convertToolsForAnthropic(tools) {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => {
    if (tool.type === "function") {
      return {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters || { type: "object", properties: {} },
      };
    }
    // 已经是 Anthropic 格式
    return tool;
  });
}

class AnthropicMessagesAdapter extends BaseLLMAdapter {
  constructor(modelConfig, credential) {
    super(modelConfig, credential);
    this.client = new Anthropic({
      apiKey: credential.apiKey,
      ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
    });
  }

  buildRequestBody(messages, { tools = null } = {}) {
    const { systemText, otherMessages } = splitSystemMessage(messages);

    const maxTokens = this.modelConfig.requestOptions?.maxTokens ?? 4096;
    const thinkingEnabled = this.modelConfig.requestOptions?.thinkingEnabled === true;
    const thinkingBudgetTokens = Number(this.modelConfig.requestOptions?.thinkingBudgetTokens) || 1024;

    const body = {
      model: this.modelConfig.modelName,
      messages: otherMessages.map((message) => ({
        role: message.role,
        content: convertToolMessagesForAnthropic(message),
      })),
      max_tokens: maxTokens,
    };

    if (systemText) {
      body.system = systemText;
    }

    if (this.modelConfig.supportsThinking !== false && thinkingEnabled) {
      const minBudget = 256;
      const safeMaxTokens = Math.max(maxTokens - 1, minBudget);
      const clampedBudget = Math.min(Math.max(thinkingBudgetTokens, minBudget), safeMaxTokens);

      body.thinking = {
        type: "enabled",
        budget_tokens: clampedBudget,
      };
    }

    // 注入工具定义
    const anthropicTools = convertToolsForAnthropic(tools);
    if (anthropicTools && anthropicTools.length > 0) {
      body.tools = anthropicTools;
    }

    return body;
  }

  // ── 原有方法（向后兼容） ──

  async doCall(messages, signal) {
    const result = await this.client.messages.create({
      ...this.buildRequestBody(messages),
      stream: false,
    }, signal ? { signal } : undefined);

    const textBlocks = result.content?.filter((block) => block.type === "text") ?? [];
    const reply = textBlocks.map((block) => block.text).join("");

    const thinkingBlocks = result.content?.filter((block) => block.type === "thinking") ?? [];
    const reasoning = thinkingBlocks.map((block) => block.thinking).join("\n");

    return this.buildResult({
      reply,
      reasoning,
      usage: formatTokenUsage(result.usage),
      responseId: result.id ?? null,
    });
  }

  async doStream(messages, onChunk, signal) {
    const stream = await this.client.messages.create({
      ...this.buildRequestBody(messages),
      stream: true,
    }, signal ? { signal } : undefined);

    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };
    let responseId = null;

    for await (const chunk of stream) {
      responseId = chunk.id ?? responseId;

      if (
        chunk.type === "content_block_delta" &&
        chunk.delta?.type === "text_delta"
      ) {
        const delta = chunk.delta.text ?? "";
        reply += delta;
        await onChunk?.({ delta });
      }

      if (
        chunk.type === "content_block_delta" &&
        chunk.delta?.type === "thinking_delta"
      ) {
        const reasoningDelta = chunk.delta.thinking ?? "";
        reasoning += reasoningDelta;
        await onChunk?.({ delta: "", reasoningDelta });
      }

      if (chunk.type === "message_delta" && chunk.usage) {
        usage = formatTokenUsage(chunk.usage);
      }

      if (chunk.type === "message_start" && chunk.message?.usage) {
        usage = formatTokenUsage(chunk.message.usage);
      }
    }

    return this.buildResult({
      reply,
      reasoning,
      usage,
      responseId,
    });
  }

  // ── Tool Calling 方法 ──

  async doCallWithTools(messages, tools, signal) {
    const result = await this.client.messages.create({
      ...this.buildRequestBody(messages, { tools }),
      stream: false,
    }, signal ? { signal } : undefined);

    const textBlocks = result.content?.filter((block) => block.type === "text") ?? [];
    const reply = textBlocks.map((block) => block.text).join("");

    const thinkingBlocks = result.content?.filter((block) => block.type === "thinking") ?? [];
    const reasoning = thinkingBlocks.map((block) => block.thinking).join("\n");

    // 提取 tool_use blocks
    const toolUseBlocks = result.content?.filter((block) => block.type === "tool_use") ?? [];
    const toolCalls =
      result.stop_reason === "tool_use"
        ? toolUseBlocks.map((block) => ({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          }))
        : [];

    // 构造 assistant message
    const assistantMessage = {
      role: "assistant",
      content: result.content
        ?.filter((block) => block.type === "text" || block.type === "tool_use")
        .map((block) => {
          if (block.type === "text") return { type: "text", text: block.text };
          if (block.type === "tool_use") return block;
          return block;
        }),
    };

    return {
      ...this.buildResult({
        reply,
        reasoning,
        usage: formatTokenUsage(result.usage),
        responseId: result.id ?? null,
      }),
      toolCalls,
      message: assistantMessage,
    };
  }

  async doStreamWithTools(messages, tools, onChunk, signal) {
    const stream = await this.client.messages.create({
      ...this.buildRequestBody(messages, { tools }),
      stream: true,
    }, signal ? { signal } : undefined);
    return this.collectStreamResult(stream, onChunk);
  }

  async createStreamWithTools(messages, tools, signal) {
    return this.client.messages.create({
      ...this.buildRequestBody(messages, { tools }),
      stream: true,
    }, signal ? { signal } : undefined);
  }

  async collectStreamResult(stream, onChunk) {
    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };
    let responseId = null;
    let stopReason = null;

    // 收集 tool_use blocks
    const toolUseBlocks = new Map(); // id → { id, name, input }
    let currentToolBlock = null;

    // 收集完整 content blocks 用于构造 assistant message
    const contentBlocks = [];

    for await (const chunk of stream) {
      responseId = chunk.id ?? responseId;

      if (chunk.type === "message_start" && chunk.message?.usage) {
        usage = formatTokenUsage(chunk.message.usage);
      }

      if (chunk.type === "message_delta") {
        stopReason = chunk.delta?.stop_reason || stopReason;
        if (chunk.usage) {
          usage = formatTokenUsage(chunk.usage);
        }
      }

      // content_block_start: 开始一个新的 content block
      if (chunk.type === "content_block_start") {
        const block = chunk.content_block;
        if (block?.type === "tool_use") {
          currentToolBlock = { id: block.id, name: block.name, inputJson: "" };
          toolUseBlocks.set(block.id, currentToolBlock);
        }
      }

      // content_block_delta: 增量内容
      if (chunk.type === "content_block_delta") {
        if (chunk.delta?.type === "text_delta") {
          const delta = chunk.delta.text ?? "";
          reply += delta;
          await onChunk?.({ delta });
        }

        if (chunk.delta?.type === "thinking_delta") {
          const reasoningDelta = chunk.delta.thinking ?? "";
          reasoning += reasoningDelta;
          await onChunk?.({ delta: "", reasoningDelta });
        }

        if (chunk.delta?.type === "input_json_delta" && currentToolBlock) {
          currentToolBlock.inputJson += chunk.delta.partial_json ?? "";
        }
      }

      // content_block_stop: block 完成
      if (chunk.type === "content_block_stop" && currentToolBlock) {
        contentBlocks.push({
          type: "tool_use",
          id: currentToolBlock.id,
          name: currentToolBlock.name,
          input: currentToolBlock.inputJson
            ? (() => { try { return JSON.parse(currentToolBlock.inputJson); } catch { return {}; } })()
            : {},
        });
        currentToolBlock = null;
      }
    }

    const toolCalls =
      stopReason === "tool_use"
        ? [...toolUseBlocks.values()].map((tb) => ({
            id: tb.id,
            type: "function",
            function: {
              name: tb.name,
              arguments: tb.inputJson || "{}",
            },
          }))
        : [];

    // 构造 assistant message
    const textContent = reply ? [{ type: "text", text: reply }] : [];
    const assistantMessage = {
      role: "assistant",
      content: [...textContent, ...contentBlocks],
    };

    return {
      reply,
      reasoning,
      usage,
      responseId,
      toolCalls,
      message: assistantMessage,
    };
  }
}

/**
 * 转换 tool message 为 Anthropic 格式
 */
function convertToolMessagesForAnthropic(message) {
  if (message.role !== "tool") {
    return {
      role: message.role,
      content: convertMultimodalContentForClaude(message.content),
    };
  }

  // Anthropic 的 tool result 格式
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      },
    ],
  };
}

export function createAnthropicMessagesAdapter(modelConfig, credential) {
  const adapter = new AnthropicMessagesAdapter(modelConfig, credential);
  return {
    call: (args) => adapter.call(args),
    stream: (args) => adapter.stream(args),
    callWithTools: (args) => adapter.callWithTools(args),
    streamWithTools: (args) => adapter.streamWithTools(args),
  };
}
