import Anthropic from "@anthropic-ai/sdk";
import {
  formatTokenUsage,
  splitSystemMessage,
  convertMultimodalContentForClaude,
} from "./baseAdapter.js";

export function createAnthropicMessagesAdapter(modelConfig, credential) {
  const client = new Anthropic({
    apiKey: credential.apiKey,
    ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
  });

  function buildRequestBody(messages) {
    const { systemText, otherMessages } = splitSystemMessage(messages);

    const maxTokens = modelConfig.requestOptions?.maxTokens ?? 4096;
    const thinkingEnabled = modelConfig.requestOptions?.thinkingEnabled === true;
    const thinkingBudgetTokens = Number(modelConfig.requestOptions?.thinkingBudgetTokens) || 1024;

    const body = {
      model: modelConfig.modelName,
      messages: otherMessages.map((message) => ({
        role: message.role,
        content: convertMultimodalContentForClaude(message.content),
      })),
      max_tokens: maxTokens,
    };

    if (systemText) {
      body.system = systemText;
    }

    if (thinkingEnabled) {
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

  async function call({ messages }) {
    const result = await client.messages.create({
      ...buildRequestBody(messages),
      stream: false,
    });

    const textBlocks = result.content?.filter((block) => block.type === "text") ?? [];
    const reply = textBlocks.map((block) => block.text).join("");

    const thinkingBlocks = result.content?.filter((block) => block.type === "thinking") ?? [];
    const reasoning = thinkingBlocks.map((block) => block.thinking).join("\n");

    return {
      reply: reply || "",
      reasoning: reasoning.trim() || "",
      usage: formatTokenUsage(result.usage),
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId: result.id ?? null,
    };
  }

  async function stream({ messages, onChunk }) {
    const stream = await client.messages.create({
      ...buildRequestBody(messages),
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

    return {
      reply: reply.trim() || "",
      reasoning: reasoning.trim() || "",
      usage,
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId,
    };
  }

  return { call, stream };
}
