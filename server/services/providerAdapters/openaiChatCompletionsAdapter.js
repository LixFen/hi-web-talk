import OpenAI from "openai";
import {
  formatTokenUsage,
  convertMultimodalContentForOpenAI,
  mergeSystemIntoFirstUser,
} from "./baseAdapter.js";

function buildExtraBody(modelConfig) {
  const opts = modelConfig.requestOptions ?? {};
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
    const requestBody = {
      model: modelConfig.modelName,
      messages: normalizeMessages(messages),
      stream: false,
    };

    const extraBody = buildExtraBody(modelConfig);
    if (extraBody) {
      requestBody.extra_body = extraBody;
    }

    const completion = await client.chat.completions.create(requestBody);

    const message = completion.choices?.[0]?.message ?? {};

    return {
      reply: message.content || "",
      reasoning: extractReasoningFromMessage(message),
      usage: formatTokenUsage(completion.usage),
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId: completion.id ?? null,
    };
  }

  async function stream({ messages, onChunk }) {
    const requestBody = {
      model: modelConfig.modelName,
      messages: normalizeMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    };

    const extraBody = buildExtraBody(modelConfig);
    if (extraBody) {
      requestBody.extra_body = extraBody;
    }

    const stream = await client.chat.completions.create(requestBody);

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
