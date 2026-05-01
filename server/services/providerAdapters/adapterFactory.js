import { createOpenAIChatCompletionsAdapter } from "./openaiChatCompletionsAdapter.js";
import { createOpenAIResponsesAdapter } from "./openaiResponsesAdapter.js";
import { createAnthropicMessagesAdapter } from "./anthropicMessagesAdapter.js";
import { createGoogleGenAIAdapter } from "./googleGenAIAdapter.js";

const adapterCache = new Map();

function getAdapterCacheKey(modelConfig, credential) {
  return JSON.stringify({
    providerType: modelConfig.providerType,
    baseURL: modelConfig.baseURL || "",
    apiKeyHash: credential.apiKey ? credential.apiKey.slice(-8) : "",
  });
}

function createAdapter(modelConfig, credential) {
  switch (modelConfig.providerType) {
    case "openai-chat-completions":
      return createOpenAIChatCompletionsAdapter(modelConfig, credential);
    case "openai-responses":
      return createOpenAIResponsesAdapter(modelConfig, credential);
    case "anthropic-messages":
      return createAnthropicMessagesAdapter(modelConfig, credential);
    case "google-generative-ai":
      return createGoogleGenAIAdapter(modelConfig, credential);
    default:
      break;
  }

  const error = new Error(`不支持的 providerType: ${modelConfig.providerType}`);
  error.status = 400;
  throw error;
}

export function getAdapter(modelConfig, credential) {
  const cacheKey = getAdapterCacheKey(modelConfig, credential);

  if (!adapterCache.has(cacheKey)) {
    adapterCache.set(cacheKey, createAdapter(modelConfig, credential));
  }

  return adapterCache.get(cacheKey);
}
