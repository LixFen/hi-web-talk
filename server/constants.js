import path from "path";

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const CONFIG_DIR = path.join(DATA_DIR, "config");
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export const DATABASE_FILE = path.join(DATA_DIR, "hi-web-talk.sqlite");
export const JWT_SECRET = process.env.JWT_SECRET || "hi-web-talk-jwt-secret-change-in-production";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export const DEFAULT_SYSTEM_PROMPT =
  "You are Hi Web Talk, a helpful AI assistant inside a local web chat app. Answer clearly, warmly, and concisely in Chinese unless the user asks for another language.";

export const MODEL_PROVIDER_DEFINITIONS = [
  {
    key: "openai-responses",
    label: "OpenAI Responses",
    description:
      "\u9002\u7528\u4e8e OpenAI Responses API\uff0csystem prompt \u4f1a\u4ee5 developer \u89d2\u8272\u6ce8\u5165\u3002",
    requestStyle: "responses",
    defaultBaseURL: "",
    defaultEnvKeyName: "OPENAI_API_KEY",
    defaultSystemPromptRole: "developer",
    defaultRequestOptions: {
      reasoningEffort: "low",
    },
    supportsStreaming: true,
    supportsReasoningEffort: true,
  },
  {
    key: "openai-chat-completions",
    label: "OpenAI Compatible Chat",
    description:
      "\u9002\u7528\u4e8e\u517c\u5bb9 OpenAI Chat Completions \u7684\u670d\u52a1\uff0c\u5982 DeepSeek\u3001OpenRouter \u6216\u672c\u5730\u4ee3\u7406\u3002",
    requestStyle: "chat.completions",
    defaultBaseURL: "",
    defaultEnvKeyName: "OPENAI_API_KEY",
    defaultSystemPromptRole: "system",
    defaultRequestOptions: {},
    supportsStreaming: true,
    supportsReasoningEffort: false,
  },
];

export const DEFAULT_MODELS = [
  {
    alias: "openai:gpt-5-mini-2025-08-07",
    label: "GPT-5 Mini",
    providerType: "openai-responses",
    baseURL: "",
    apiKeySource: "env",
    apiKeyEnvName: "OPENAI_API_KEY",
    modelName: "gpt-5-mini-2025-08-07",
    enabled: true,
    supportsStreaming: true,
    systemPromptRole: "developer",
    requestOptions: {
      reasoningEffort: "low",
    },
    isPreset: true,
  },
  {
    alias: "deepseek:deepseek-chat",
    label: "DeepSeek Chat",
    providerType: "openai-chat-completions",
    baseURL: "https://api.deepseek.com",
    apiKeySource: "env",
    apiKeyEnvName: "DEEPSEEK_API_KEY",
    modelName: "deepseek-chat",
    enabled: true,
    supportsStreaming: true,
    systemPromptRole: "system",
    requestOptions: {},
    isPreset: true,
  },
];

export const DEFAULT_APP_SETTINGS = {
  darkMode: "system",
  defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  enableDangerousBlockDelete: false,
  bottomDockMode: "smart",
  showChatFocusOutline: true,
  hideWideScreenSideBranches: false,
  showChatAdaptationButtons: true,
  showContextIgnoreButton: true,
  showSummaryPreferButton: true,
  showSummaryPinButton: true,
  showSummaryGenerateButton: true,
  showImportantLabelButton: true,
  showPendingOrganizeLabelButton: true,
};

export const DEFAULT_SESSION_TITLE = "\u65b0\u5bf9\u8bdd";

