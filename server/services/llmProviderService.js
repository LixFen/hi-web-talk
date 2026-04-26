import OpenAI from "openai";
import {
  createLegacyModelConfig,
  getProviderDefinitionByType,
  resolveModelCredential,
} from "./modelConfigService.js";

const clientCache = new Map();

function formatTokenUsage(usage = {}) {
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const total = Number(usage.total_tokens ?? input + output);

  return { input, output, total };
}

function normalizeResponseMessages(messages, systemPromptRole = "developer") {
  return messages.map((message) => ({
    role:
      message.role === "system" && systemPromptRole === "developer"
        ? "developer"
        : message.role,
    content: message.content,
  }));
}

function normalizeChatMessages(messages, systemPromptRole = "system") {
  return messages.map((message) => ({
    role:
      message.role === "system" && systemPromptRole === "developer"
        ? "developer"
        : message.role,
    content: message.content,
  }));
}

function getClientCacheKey(modelConfig, apiKey) {
  return JSON.stringify({
    providerType: modelConfig.providerType,
    baseURL: modelConfig.baseURL || "",
    apiKeyHash: apiKey ? apiKey.slice(-8) : "",
  });
}

function getClient(modelConfig, apiKey) {
  const cacheKey = getClientCacheKey(modelConfig, apiKey);

  if (!clientCache.has(cacheKey)) {
    clientCache.set(
      cacheKey,
      new OpenAI({
        apiKey,
        ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {}),
      }),
    );
  }

  return clientCache.get(cacheKey);
}

export async function callProviderModel({ modelConfig, provider, model, messages }) {
  const resolvedModelConfig = modelConfig ?? createLegacyModelConfig(provider, model);
  const providerDefinition = getProviderDefinitionByType(resolvedModelConfig.providerType);

  if (!providerDefinition) {
    const error = new Error("��֧�����ģ���ṩ�����͡�");
    error.status = 400;
    throw error;
  }

  const credential = await resolveModelCredential(resolvedModelConfig);

  if (!credential.configured || !credential.apiKey) {
    const error = new Error(
      resolvedModelConfig.apiKeySource === "stored"
        ? "���ģ�ͻ�û�б������ API Key��"
        : `����˻�û������ ${resolvedModelConfig.apiKeyEnvName || "��Ӧ��������"}��`,
    );
    error.status = 500;
    throw error;
  }

  const client = getClient(resolvedModelConfig, credential.apiKey);

  if (providerDefinition.requestStyle === "chat.completions") {
    const completion = await client.chat.completions.create({
      model: resolvedModelConfig.modelName,
      messages: normalizeChatMessages(
        messages,
        resolvedModelConfig.systemPromptRole || providerDefinition.defaultSystemPromptRole,
      ),
      ...(resolvedModelConfig.supportsStreaming ? { stream: false } : {}),
    });

    return {
      reply: completion.choices?.[0]?.message?.content || "����ʱû�����ɵ�����ʾ�Ļظ���",
      usage: formatTokenUsage(completion.usage),
      provider: resolvedModelConfig.providerType,
      providerType: resolvedModelConfig.providerType,
      model: resolvedModelConfig.modelName,
      responseId: completion.id ?? null,
    };
  }

  const result = await client.responses.create({
    model: resolvedModelConfig.modelName,
    input: normalizeResponseMessages(
      messages,
      resolvedModelConfig.systemPromptRole || providerDefinition.defaultSystemPromptRole,
    ),
    ...(resolvedModelConfig.requestOptions?.reasoningEffort
      ? {
          reasoning: {
            effort: resolvedModelConfig.requestOptions.reasoningEffort,
          },
        }
      : {}),
  });

  return {
    reply: result.output_text?.trim() || "����ʱû�����ɵ�����ʾ�Ļظ���",
    usage: formatTokenUsage(result.usage),
    provider: resolvedModelConfig.providerType,
    providerType: resolvedModelConfig.providerType,
    model: resolvedModelConfig.modelName,
    responseId: result.id ?? null,
  };
}

function extractChatCompletionDelta(chunk) {
  return chunk?.choices?.[0]?.delta?.content ?? "";
}

function extractResponsesDelta(event) {
  if (event?.type === "response.output_text.delta") {
    return event.delta ?? "";
  }

  return "";
}

function extractResponsesUsage(event) {
  if (event?.type === "response.completed") {
    return formatTokenUsage(event.response?.usage);
  }

  return null;
}

export async function streamProviderModel({ modelConfig, provider, model, messages, onChunk }) {
  const resolvedModelConfig = modelConfig ?? createLegacyModelConfig(provider, model);
  const providerDefinition = getProviderDefinitionByType(resolvedModelConfig.providerType);

  if (resolvedModelConfig.supportsStreaming === false) {
    const error = new Error("该模型配置不支持流式传输。");
    error.status = 400;
    throw error;
  }

  if (!providerDefinition) {
    const error = new Error("��֧�����ģ���ṩ�����͡�");
    error.status = 400;
    throw error;
  }

  const credential = await resolveModelCredential(resolvedModelConfig);

  if (!credential.configured || !credential.apiKey) {
    const error = new Error(
      resolvedModelConfig.apiKeySource === "stored"
        ? "���ģ�ͻ�û�б������ API Key��"
        : `����˻�û������ ${resolvedModelConfig.apiKeyEnvName || "��Ӧ��������"}��`,
    );
    error.status = 500;
    throw error;
  }

  const client = getClient(resolvedModelConfig, credential.apiKey);
  let reply = "";
  let usage = { input: 0, output: 0, total: 0 };
  let responseId = null;

  if (providerDefinition.requestStyle === "chat.completions") {
    const stream = await client.chat.completions.create({
      model: resolvedModelConfig.modelName,
      messages: normalizeChatMessages(
        messages,
        resolvedModelConfig.systemPromptRole || providerDefinition.defaultSystemPromptRole,
      ),
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      responseId = chunk.id ?? responseId;
      const delta = extractChatCompletionDelta(chunk);

      if (delta) {
        reply += delta;
        await onChunk?.(delta);
      }

      if (chunk?.usage) {
        usage = formatTokenUsage(chunk.usage);
      }
    }

    return {
      reply: reply.trim() || "����ʱû�����ɵ�����ʾ�Ļظ���",
      usage,
      provider: resolvedModelConfig.providerType,
      providerType: resolvedModelConfig.providerType,
      model: resolvedModelConfig.modelName,
      responseId,
    };
  }

  const stream = await client.responses.create({
    model: resolvedModelConfig.modelName,
    input: normalizeResponseMessages(
      messages,
      resolvedModelConfig.systemPromptRole || providerDefinition.defaultSystemPromptRole,
    ),
    stream: true,
    ...(resolvedModelConfig.requestOptions?.reasoningEffort
      ? {
          reasoning: {
            effort: resolvedModelConfig.requestOptions.reasoningEffort,
          },
        }
      : {}),
  });

  for await (const event of stream) {
    responseId = event?.response?.id ?? responseId;

    const delta = extractResponsesDelta(event);
    if (delta) {
      reply += delta;
      await onChunk?.(delta);
    }

    const nextUsage = extractResponsesUsage(event);
    if (nextUsage) {
      usage = nextUsage;
    }
  }

  return {
    reply: reply.trim() || "����ʱû�����ɵ�����ʾ�Ļظ���",
    usage,
    provider: resolvedModelConfig.providerType,
    providerType: resolvedModelConfig.providerType,
    model: resolvedModelConfig.modelName,
    responseId,
  };
}
