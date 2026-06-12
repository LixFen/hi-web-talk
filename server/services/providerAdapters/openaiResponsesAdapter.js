import OpenAI from "openai";
import {
  formatTokenUsage,
  convertMultimodalContentForOpenAI,
  mergeSystemIntoFirstUser,
} from "./baseAdapter.js";
import { BaseLLMAdapter } from "./baseLLMAdapter.js";

class OpenAIResponsesAdapter extends BaseLLMAdapter {
  constructor(modelConfig, credential) {
    super(modelConfig, credential);
    this.client = new OpenAI({
      apiKey: credential.apiKey,
      ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
    });
    this.systemPromptRole = modelConfig.systemPromptRole || "developer";
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
    }));
  }

  buildRequestOptions(messages, { tools = null } = {}) {
    const options = {
      model: this.modelConfig.modelName,
      input: this.normalizeMessages(messages),
      stream: false,
    };

    if (this.modelConfig.supportsThinking !== false && this.modelConfig.requestOptions?.reasoningEffort) {
      options.reasoning = {
        effort: this.modelConfig.requestOptions.reasoningEffort,
      };
    }

    // 注入工具定义
    if (tools && tools.length > 0) {
      options.tools = tools.map((tool) => {
        if (tool.type === "function") {
          return {
            type: "function",
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters || { type: "object", properties: {} },
            strict: false,
          };
        }
        return tool;
      });
    }

    return options;
  }

  // ── 原有方法（向后兼容） ──

  async doCall(messages) {
    const result = await this.client.responses.create(this.buildRequestOptions(messages));

    let reasoning = "";
    const reasoningItems = result.output?.filter((item) => item.type === "reasoning") ?? [];
    for (const item of reasoningItems) {
      if (item.summary) {
        const summaryText = Array.isArray(item.summary)
          ? item.summary.map((s) => s.text || s).join("\n")
          : item.summary;
        reasoning += summaryText;
      } else if (item.text) {
        reasoning += item.text;
      }
    }

    return this.buildResult({
      reply: result.output_text || "",
      reasoning,
      usage: formatTokenUsage(result.usage),
      responseId: result.id ?? null,
    });
  }

  async doStream(messages, onChunk) {
    const stream = await this.client.responses.create({
      ...this.buildRequestOptions(messages),
      stream: true,
    });

    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };
    let responseId = null;

    for await (const event of stream) {
      responseId = event?.response?.id ?? responseId;

      if (event?.type === "response.output_text.delta") {
        const delta = event.delta ?? "";
        reply += delta;
        await onChunk?.({ delta });
      }

      if (event?.type === "response.reasoning_part.added" && event.part?.text) {
        reasoning += event.part.text;
        await onChunk?.({ delta: "", reasoningDelta: event.part.text });
      }

      if (event?.type === "response.reasoning_text.delta") {
        const reasoningDelta = event.delta ?? "";
        reasoning += reasoningDelta;
        await onChunk?.({ delta: "", reasoningDelta });
      }

      if (
        event?.type === "response.completed" &&
        event.response?.usage
      ) {
        usage = formatTokenUsage(event.response.usage);
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
    const result = await this.client.responses.create(
      this.buildRequestOptions(messages, { tools })
    );

    let reasoning = "";
    const reasoningItems = result.output?.filter((item) => item.type === "reasoning") ?? [];
    for (const item of reasoningItems) {
      if (item.summary) {
        const summaryText = Array.isArray(item.summary)
          ? item.summary.map((s) => s.text || s).join("\n")
          : item.summary;
        reasoning += summaryText;
      } else if (item.text) {
        reasoning += item.text;
      }
    }

    // 提取 function_call output items
    const functionCallItems = result.output?.filter((item) => item.type === "function_call") ?? [];
    const toolCalls =
      functionCallItems.length > 0
        ? functionCallItems.map((item) => ({
            id: item.call_id || item.id || `call_${Date.now()}`,
            type: "function",
            function: {
              name: item.name,
              arguments: item.arguments || "{}",
            },
          }))
        : [];

    // 构造 output items 作为 assistant message
    const outputItems = result.output?.filter(
      (item) => item.type === "message" || item.type === "function_call"
    ) ?? [];

    return {
      ...this.buildResult({
        reply: result.output_text || "",
        reasoning,
        usage: formatTokenUsage(result.usage),
        responseId: result.id ?? null,
      }),
      toolCalls,
      message: {
        role: "assistant",
        content: result.output_text || null,
        output_items: outputItems,
      },
    };
  }

  async doStreamWithTools(messages, tools, onChunk) {
    const stream = await this.client.responses.create({
      ...this.buildRequestOptions(messages, { tools }),
      stream: true,
    });
    return this.collectStreamResult(stream, onChunk);
  }

  async createStreamWithTools(messages, tools) {
    return this.client.responses.create({
      ...this.buildRequestOptions(messages, { tools }),
      stream: true,
    });
  }

  async collectStreamResult(stream, onChunk) {
    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };
    let responseId = null;
    let isIncomplete = false;
    const functionCalls = [];

    for await (const event of stream) {
      responseId = event?.response?.id ?? responseId;

      if (event?.type === "response.output_text.delta") {
        const delta = event.delta ?? "";
        reply += delta;
        await onChunk?.({ delta });
      }

      if (event?.type === "response.reasoning_part.added" && event.part?.text) {
        reasoning += event.part.text;
        await onChunk?.({ delta: "", reasoningDelta: event.part.text });
      }

      if (event?.type === "response.reasoning_text.delta") {
        const reasoningDelta = event.delta ?? "";
        reasoning += reasoningDelta;
        await onChunk?.({ delta: "", reasoningDelta });
      }

      // 检测 function call（按 call_id 追踪，避免同名调用被合并）
      if (event?.type === "response.function_call_arguments.delta") {
        const existing = functionCalls.find((fc) => fc.call_id === event.call_id);
        if (existing) {
          existing.arguments += event.delta ?? "";
        } else {
          functionCalls.push({
            name: event.name,
            call_id: event.call_id,
            arguments: event.delta ?? "",
          });
        }
      }

      if (event?.type === "response.incomplete") {
        isIncomplete = true;
      }

      if (
        event?.type === "response.completed" &&
        event.response?.usage
      ) {
        usage = formatTokenUsage(event.response.usage);
      }
    }

    const toolCalls =
      functionCalls.length > 0
        ? functionCalls.map((fc) => ({
            id: fc.call_id || `call_${Date.now()}`,
            type: "function",
            function: {
              name: fc.name,
              arguments: fc.arguments || "{}",
            },
          }))
        : [];

    return {
      reply,
      reasoning,
      usage,
      responseId,
      toolCalls,
      message: {
        role: "assistant",
        content: reply || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    };
  }
}

export function createOpenAIResponsesAdapter(modelConfig, credential) {
  const adapter = new OpenAIResponsesAdapter(modelConfig, credential);
  return {
    call: (args) => adapter.call(args),
    stream: (args) => adapter.stream(args),
    callWithTools: (args) => adapter.callWithTools(args),
    streamWithTools: (args) => adapter.streamWithTools(args),
  };
}
