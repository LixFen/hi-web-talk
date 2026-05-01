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

    const body = {
      model: modelConfig.modelName,
      messages: otherMessages.map((message) => ({
        role: message.role,
        content: convertMultimodalContentForClaude(message.content),
      })),
      max_tokens: modelConfig.requestOptions?.maxTokens ?? 4096,
    };

    if (systemText) {
      body.system = systemText;
    }

    return body;
  }

  async function call({ messages }) {
    const result = await client.messages.create({
      ...buildRequestBody(messages),
      stream: false,
    });

    const reply =
      result.content?.[0]?.type === "text" ? result.content[0].text : "";

    return {
      reply: reply || "",
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
        await onChunk?.(delta);
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
      usage,
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId,
    };
  }

  return { call, stream };
}
