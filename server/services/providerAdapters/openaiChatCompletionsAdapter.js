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
    }));
  }

  buildRequestBody(messages, stream = false) {
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

    return requestBody;
  }

  async doCall(messages) {
    const requestBody = this.buildRequestBody(messages, false);
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
    const requestBody = this.buildRequestBody(messages, true);
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
}

export function createOpenAIChatCompletionsAdapter(modelConfig, credential) {
  const adapter = new OpenAIChatCompletionsAdapter(modelConfig, credential);
  return { call: (args) => adapter.call(args), stream: (args) => adapter.stream(args) };
}
