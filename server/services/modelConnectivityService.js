import {
  getModelByAlias,
  getProviderDefinitionByType,
  resolveModelCredential,
} from "./modelConfigService.js";
import { getProviderById, resolveProviderCredential } from "./providerConfigService.js";
import { getAdapter } from "./providerAdapters/adapterFactory.js";

const CONNECTIVITY_TIMEOUT_MS = 15_000;

function createConnectivityError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isConnectivityAbort(error, signal) {
  return signal.aborted
    || error?.name === "AbortError"
    || error?.name === "APIUserAbortError"
    || error?.message === "Request was aborted.";
}

function buildModelConfigFromProvider(provider, payload) {
  const definition = getProviderDefinitionByType(provider.providerType);

  return {
    alias: `__connectivity_test__:${provider.providerId}:${payload.modelName}`,
    label: "Connectivity test",
    providerId: provider.providerId,
    providerType: provider.providerType,
    baseURL: provider.baseURL,
    apiKeySource: provider.apiKeySource,
    apiKeyEnvName: provider.apiKeyEnvName,
    apiKeyEncrypted: provider.apiKeyEncrypted || "",
    modelName: payload.modelName,
    supportsStreaming: true,
    supportsSystemRole:
      payload.supportsSystemRole ?? definition?.supportsSystemRole ?? true,
    supportsThinking:
      payload.supportsThinking ?? definition?.supportsThinking ?? false,
    thinkingDisable: payload.thinkingDisable ?? definition?.thinkingDisableConfig ?? null,
    systemPromptRole:
      payload.systemPromptRole || provider.systemPromptRole || definition?.defaultSystemPromptRole || "system",
    requestOptions: {
      ...(provider.requestOptions ?? {}),
      ...(payload.requestOptions ?? {}),
    },
  };
}

async function resolveConnectivityTarget(payload, userId, role) {
  if (payload.alias) {
    const model = await getModelByAlias(payload.alias, userId, role);
    if (!model) {
      throw createConnectivityError(`找不到模型：${payload.alias}`, 404);
    }

    const modelConfig = {
      ...model,
      modelName: payload.modelName,
      supportsSystemRole: payload.supportsSystemRole ?? model.supportsSystemRole,
      supportsThinking: payload.supportsThinking ?? model.supportsThinking,
      thinkingDisable: payload.thinkingDisable ?? model.thinkingDisable,
      systemPromptRole: payload.systemPromptRole || model.systemPromptRole,
      requestOptions: {
        ...(model.requestOptions ?? {}),
        ...(payload.requestOptions ?? {}),
      },
    };

    return {
      modelConfig,
      credential: await resolveModelCredential(modelConfig),
    };
  }

  const provider = await getProviderById(
    payload.providerId,
    role === "admin" ? null : userId,
    role,
  );
  if (!provider) {
    throw createConnectivityError(`找不到 Provider：${payload.providerId}`, 404);
  }

  return {
    modelConfig: buildModelConfigFromProvider(provider, payload),
    credential: await resolveProviderCredential(provider),
  };
}

export async function testModelConnectivity(payload, userId, role = "user") {
  const startedAt = Date.now();
  const { modelConfig, credential } = await resolveConnectivityTarget(payload, userId, role);

  if (!credential.configured || !credential.apiKey) {
    const credentialLabel = modelConfig.apiKeySource === "stored"
      ? "已保存的 API Key"
      : modelConfig.apiKeyEnvName || "对应环境变量";
    throw createConnectivityError(`未配置${credentialLabel}。`);
  }

  const adapter = getAdapter(modelConfig, credential);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);

  try {
    await adapter.call({
      messages: [{ role: "user", content: "Reply with exactly OK." }],
      signal: controller.signal,
    });

    return {
      ok: true,
      modelName: modelConfig.modelName,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (isConnectivityAbort(error, controller.signal)) {
      throw createConnectivityError("连接测试超时，请检查 Base URL、网络和模型名称。", 504);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
