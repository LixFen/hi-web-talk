import OpenAI from "openai";
import {
  formatTokenUsage,
  convertMultimodalContentForOpenAI,
  mergeSystemIntoFirstUser,
} from "./baseAdapter.js";

export function createOpenAIChatCompletionsAdapter(modelConfig, credential) {
  const client = new OpenAI({
    apiKey: credential.apiKey,
    ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
  });

  const systemPromptRole = modelConfig.systemPromptRole || "system";

  function normalizeMessages(messages) {
    const effectiveMessages = modelConfig.supportsSystemRole === false
      ? mergeSystemIntoFirstUser(messages)
      : messages;

    return effectiveMessages.map((message) => ({
      role:
        message.role === "system" && systemPromptRole === "developer"
          ? "developer"
          : message.role,
      content: convertMultimodalContentForOpenAI(message.content),
    }));
  }

  async function call({ messages }) {
    const completion = await client.chat.completions.create({
      model: modelConfig.modelName,
      messages: normalizeMessages(messages),
      stream: false,
    });

    return {
      reply:
        completion.choices?.[0]?.message?.content ||
        "",
      usage: formatTokenUsage(completion.usage),
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId: completion.id ?? null,
    };
  }

  async function stream({ messages, onChunk }) {
    const stream = await client.chat.completions.create({
      model: modelConfig.modelName,
      messages: normalizeMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    });

    let reply = "";
    let usage = { input: 0, output: 0, total: 0 };
    let responseId = null;

    for await (const chunk of stream) {
      responseId = chunk.id ?? responseId;
      const delta = chunk?.choices?.[0]?.delta?.content ?? "";

      if (delta) {
        reply += delta;
        await onChunk?.(delta);
      }

      if (chunk?.usage) {
        usage = formatTokenUsage(chunk.usage);
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
