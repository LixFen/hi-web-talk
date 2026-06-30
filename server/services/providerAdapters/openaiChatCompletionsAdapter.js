import OpenAI from "openai";
import {
  formatTokenUsage,
  convertMultimodalContentForOpenAI,
  mergeSystemIntoFirstUser,
} from "./baseAdapter.js";
import { BaseLLMAdapter } from "./baseLLMAdapter.js";

function buildExtraBody(modelConfig) {
  const opts = modelConfig.requestOptions ?? {};
  const td = modelConfig.thinkingDisable;

  if (td && td.param) {
    return { [td.param]: td.value };
  }

  if (modelConfig.supportsThinking === false) {
    return undefined;
  }

  const providerType = modelConfig.providerType;
  const extraBody = {};

  if (providerType === "doubao") {
    const effort = opts.reasoningEffort;
    if (effort && effort !== "") {
      extraBody.reasoning_effort = effort;
    }
  } else if (providerType === "glm") {
    const effort = opts.reasoningEffort;
    if (effort && effort !== "") {
      extraBody.reasoning_effort = effort;
    }
    if (opts.clearThinking === true) {
      extraBody.clear_thinking = true;
    }
  } else if (providerType === "kimi") {
    const budget = Number(opts.thinkingBudget) || 0;
    if (budget > 0) {
      extraBody.thinking_budget = budget;
    }
  } else if (providerType === "qwen") {
    if (opts.enableThinking === true) {
      extraBody.enable_thinking = true;
    }
    const budget = Number(opts.thinkingBudget) || 0;
    if (budget > 0) {
      extraBody.thinking_budget = budget;
    }
  }

  return Object.keys(extraBody).length > 0 ? extraBody : undefined;
}

function extractReasoningFromDelta(delta) {
  if (delta.reasoning_content != null) {
    return delta.reasoning_content;
  }

  if (delta.reasoning != null) {
    return delta.reasoning;
  }

  return "";
}

function extractReasoningFromMessage(message) {
  if (message.reasoning_content != null) {
    return message.reasoning_content;
  }

  if (message.reasoning != null) {
    return message.reasoning;
  }

  return "";
}

class OpenAIChatCompletionsAdapter extends BaseLLMAdapter {
  constructor(modelConfig, credential) {
    super(modelConfig, credential);
    this.client = new OpenAI({
      apiKey: credential.apiKey,
      ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
    });
    this.systemPromptRole = modelConfig.systemPromptRole || "system";
  }

  normalizeMessages(messages) {
    const effectiveMessages = this.modelConfig.supportsSystemRole === false
      ? mergeSystemIntoFirstUser(messages)
      : messages;

    return effectiveMessages.map((message) => ({
      role:
        message.role === "system" && this.systemPromptRole === "developer"
          ? "developer"
          : message.role,
      content: convertMultimodalContentForOpenAI(message.content),
      // ponytail: preserve tool call fields stripped by the map above
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    }));
  }

  buildRequestBody(messages, { stream = false, tools = null } = {}) {
    const requestBody = {
      model: this.modelConfig.modelName,
      messages: this.normalizeMessages(messages),
      stream,
    };

    if (stream) {
      requestBody.stream_options = { include_usage: true };
    }

    const extraBody = buildExtraBody(this.modelConfig);
    if (extraBody) {
      Object.assign(requestBody, extraBody);
    }

    // 注入工具定义
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = "auto";
    }

    return requestBody;
  }

  // ── 原有方法（向后兼容） ──

  async doCall(messages) {
    const requestBody = this.buildRequestBody(messages, { stream: false });
    const completion = await this.client.chat.completions.create(requestBody);

    const message = completion.choices?.[0]?.message ?? {};

    return this.buildResult({
      reply: message.content || "",
      reasoning: extractReasoningFromMessage(message),
      usage: formatTokenUsage(completion.usage),
      responseId: completion.id ?? null,
    });
  }

  async doStream(messages, onChunk) {
    const requestBody = this.buildRequestBody(messages, { stream: true });
    const stream = await this.client.chat.completions.create(requestBody);

    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };
    let responseId = null;

    for await (const chunk of stream) {
      responseId = chunk.id ?? responseId;
      const delta = chunk?.choices?.[0]?.delta ?? {};
      const textDelta = delta.content ?? "";
      const reasoningDelta = extractReasoningFromDelta(delta);

      if (textDelta) {
        reply += textDelta;
        await onChunk?.({ delta: textDelta });
      }

      if (reasoningDelta) {
        reasoning += reasoningDelta;
        await onChunk?.({ delta: "", reasoningDelta });
      }

      if (chunk?.usage) {
        usage = formatTokenUsage(chunk.usage);
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

  async doCallWithTools(messages, tools) {
    const requestBody = this.buildRequestBody(messages, { stream: false, tools });
    const completion = await this.client.chat.completions.create(requestBody);

    const choice = completion.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const toolCalls = choice.finish_reason === "tool_calls" ? (message.tool_calls ?? []) : [];

    return {
      ...this.buildResult({
        reply: message.content || "",
        reasoning: extractReasoningFromMessage(message),
        usage: formatTokenUsage(completion.usage),
        responseId: completion.id ?? null,
      }),
      toolCalls,
      message: {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.tool_calls,
      },
    };
  }

  async doStreamWithTools(messages, tools, onChunk) {
    const requestBody = this.buildRequestBody(messages, { stream: true, tools });
    const stream = await this.client.chat.completions.create(requestBody);
    return this.collectStreamResult(stream, onChunk);
  }

  async createStreamWithTools(messages, tools) {
    const requestBody = this.buildRequestBody(messages, { stream: true, tools });
    return this.client.chat.completions.create(requestBody);
  }

  async collectStreamResult(stream, onChunk) {
    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };
    let responseId = null;
    let finishReason = null;
    let toolCallsMap = new Map(); // index → { id, type, function: { name, arguments } }
    let currentMessage = null;

    for await (const chunk of stream) {
      responseId = chunk.id ?? responseId;
      const choice = chunk?.choices?.[0];

      if (choice) {
        finishReason = choice.finish_reason || finishReason;
        const delta = choice.delta ?? {};

        // 文本内容
        const textDelta = delta.content ?? "";
        if (textDelta) {
          reply += textDelta;
          await onChunk?.({ delta: textDelta });
        }

        // Reasoning
        const reasoningDelta = extractReasoningFromDelta(delta);
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          await onChunk?.({ delta: "", reasoningDelta });
        }

        // Tool calls（增量收集）
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsMap.has(idx)) {
              toolCallsMap.set(idx, {
                id: tc.id || "",
                type: "function",
                function: { name: "", arguments: "" },
              });
            }
            const existing = toolCallsMap.get(idx);
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name += tc.function.name;
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
          }
        }
      }

      if (chunk?.usage) {
        usage = formatTokenUsage(chunk.usage);
      }
    }

    const toolCalls =
      finishReason === "tool_calls" ? [...toolCallsMap.values()] : [];

    // 构造 assistant message（用于追加到上下文）
    const assistantMessage = {
      role: "assistant",
      content: reply || null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
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

export function createOpenAIChatCompletionsAdapter(modelConfig, credential) {
  const adapter = new OpenAIChatCompletionsAdapter(modelConfig, credential);
  return {
    call: (args) => adapter.call(args),
    stream: (args) => adapter.stream(args),
    callWithTools: (args) => adapter.callWithTools(args),
    streamWithTools: (args) => adapter.streamWithTools(args),
  };
}
