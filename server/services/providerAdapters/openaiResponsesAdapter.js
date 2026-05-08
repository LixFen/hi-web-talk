import OpenAI from "openai";
import {
  formatTokenUsage,
  convertMultimodalContentForOpenAI,
  mergeSystemIntoFirstUser,
} from "./baseAdapter.js";

export function createOpenAIResponsesAdapter(modelConfig, credential) {
  const client = new OpenAI({
    apiKey: credential.apiKey,
    ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
  });

  const systemPromptRole = modelConfig.systemPromptRole || "developer";

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

  function buildRequestOptions(messages) {
    const options = {
      model: modelConfig.modelName,
      input: normalizeMessages(messages),
      stream: false,
    };

    if (modelConfig.supportsThinking !== false && modelConfig.requestOptions?.reasoningEffort) {
      options.reasoning = {
        effort: modelConfig.requestOptions.reasoningEffort,
      };
    }

    return options;
  }

  async function call({ messages }) {
    const result = await client.responses.create(buildRequestOptions(messages));

    let reasoning = "";
    const reasoningItems = result.output?.filter((item) => item.type === "reasoning") ?? [];
    for (const item of reasoningItems) {
      if (item.summary) {
        reasoning += item.summary;
      } else if (item.text) {
        reasoning += item.text;
      }
    }

    return {
      reply: result.output_text?.trim() || "",
      reasoning: reasoning.trim() || "",
      usage: formatTokenUsage(result.usage),
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId: result.id ?? null,
    };
  }

  async function stream({ messages, onChunk }) {
    const stream = await client.responses.create({
      ...buildRequestOptions(messages),
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
