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

  buildRequestOptions(messages) {
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

    return options;
  }

  async doCall(messages) {
    const result = await this.client.responses.create(this.buildRequestOptions(messages));

    let reasoning = "";
    const reasoningItems = result.output?.filter((item) => item.type === "reasoning") ?? [];
    for (const item of reasoningItems) {
      if (item.summary) {
        reasoning += item.summary;
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
}

export function createOpenAIResponsesAdapter(modelConfig, credential) {
  const adapter = new OpenAIResponsesAdapter(modelConfig, credential);
  return { call: (args) => adapter.call(args), stream: (args) => adapter.stream(args) };
}
