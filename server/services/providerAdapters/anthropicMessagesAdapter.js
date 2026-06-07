import Anthropic from "@anthropic-ai/sdk";
import {
  formatTokenUsage,
  splitSystemMessage,
  convertMultimodalContentForClaude,
} from "./baseAdapter.js";
import { BaseLLMAdapter } from "./baseLLMAdapter.js";

class AnthropicMessagesAdapter extends BaseLLMAdapter {
  constructor(modelConfig, credential) {
    super(modelConfig, credential);
    this.client = new Anthropic({
      apiKey: credential.apiKey,
      ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
    });
  }

  buildRequestBody(messages) {
    const { systemText, otherMessages } = splitSystemMessage(messages);

    const maxTokens = this.modelConfig.requestOptions?.maxTokens ?? 4096;
    const thinkingEnabled = this.modelConfig.requestOptions?.thinkingEnabled === true;
    const thinkingBudgetTokens = Number(this.modelConfig.requestOptions?.thinkingBudgetTokens) || 1024;

    const body = {
      model: this.modelConfig.modelName,
      messages: otherMessages.map((message) => ({
        role: message.role,
        content: convertMultimodalContentForClaude(message.content),
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

    return body;
  }

  async doCall(messages) {
    const result = await this.client.messages.create({
      ...this.buildRequestBody(messages),
      stream: false,
    });

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

  async doStream(messages, onChunk) {
    const stream = await this.client.messages.create({
      ...this.buildRequestBody(messages),
      stream: true,
    });

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
}

export function createAnthropicMessagesAdapter(modelConfig, credential) {
  const adapter = new AnthropicMessagesAdapter(modelConfig, credential);
  return { call: (args) => adapter.call(args), stream: (args) => adapter.stream(args) };
}
