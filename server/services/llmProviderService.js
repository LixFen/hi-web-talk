import {
  createLegacyModelConfig,
  getProviderDefinitionByType,
  resolveModelCredential,
} from "./modelConfigService.js";
import { getAdapter, clearAdapterCache } from "./providerAdapters/adapterFactory.js";

export async function callProviderModel({ modelConfig, provider, model, messages, tools, onToolEvent }) {
  const resolvedModelConfig = modelConfig ?? createLegacyModelConfig(provider, model);
  const providerDefinition = getProviderDefinitionByType(resolvedModelConfig.providerType);

  if (!providerDefinition) {
    const error = new Error("不支持的模型提供商类型。");
    error.status = 400;
    throw error;
  }

  const credential = await resolveModelCredential(resolvedModelConfig);

  if (!credential.configured || !credential.apiKey) {
    const error = new Error(
      resolvedModelConfig.apiKeySource === "stored"
        ? "该模型或没有配置 API Key。"
        : `当前账户没有配置 ${resolvedModelConfig.apiKeyEnvName || "对应环境变量"}。`,
    );
    error.status = 500;
    throw error;
  }

  const adapter = getAdapter(resolvedModelConfig, credential);

  // 如果有 tools，使用 tool calling 版本
  if (tools && tools.length > 0 && adapter.callWithTools) {
    return adapter.callWithTools({ messages, tools, onToolEvent });
  }

  return adapter.call({ messages });
}

export async function streamProviderModel({ modelConfig, provider, model, messages, tools, onChunk, onToolEvent }) {
  const resolvedModelConfig = modelConfig ?? createLegacyModelConfig(provider, model);
  const providerDefinition = getProviderDefinitionByType(resolvedModelConfig.providerType);

  if (resolvedModelConfig.supportsStreaming === false) {
    const error = new Error("该模型配置不支持流式传输。");
    error.status = 400;
    throw error;
  }

  if (!providerDefinition) {
    const error = new Error("不支持的模型提供商类型。");
    error.status = 400;
    throw error;
  }

  const credential = await resolveModelCredential(resolvedModelConfig);

  if (!credential.configured || !credential.apiKey) {
    const error = new Error(
      resolvedModelConfig.apiKeySource === "stored"
        ? "该模型或没有配置 API Key。"
        : `当前账户没有配置 ${resolvedModelConfig.apiKeyEnvName || "对应环境变量"}。`,
    );
    error.status = 500;
    throw error;
  }

  const adapter = getAdapter(resolvedModelConfig, credential);

  // 如果有 tools，使用 tool calling 版本
  if (tools && tools.length > 0 && adapter.streamWithTools) {
    return adapter.streamWithTools({ messages, tools, onChunk, onToolEvent });
  }

  return adapter.stream({ messages, onChunk });
}

export function invalidateModelAdapterCache() {
  clearAdapterCache();
}
