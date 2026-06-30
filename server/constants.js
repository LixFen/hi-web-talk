import path from "path";

export const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");
export const DATA_DIR = process.env.HI_WEB_TALK_DATA_DIR
  ? path.resolve(process.env.HI_WEB_TALK_DATA_DIR)
  : DEFAULT_DATA_DIR;
export const CONFIG_DIR = path.join(DATA_DIR, "config");
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export const DATABASE_FILE = path.join(DATA_DIR, "hi-web-talk.sqlite");
export const JWT_SECRET = process.env.JWT_SECRET || "hi-web-talk-jwt-secret-change-in-production";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export const DEFAULT_SYSTEM_PROMPT =
  "You are Hi Web Talk, a helpful AI assistant inside a local web chat app. Answer clearly, warmly, and concisely in Chinese unless the user asks for another language. When you use web search results, cite sources using [citation:ID] format (e.g. \"根据最新报道[citation:1]，...\").";

export const MODEL_PROVIDER_DEFINITIONS = [
  {
    key: "openai-responses",
    label: "OpenAI Responses",
    description:
      "OpenAI 原生 Responses API。推理控制：reasoning_effort（low / medium / high）。System prompt 以 developer 角色注入。支持多模态。",
    requestStyle: "responses",
    defaultBaseURL: "",
    defaultEnvKeyName: "OPENAI_API_KEY",
    defaultSystemPromptRole: "developer",
    defaultRequestOptions: {
      reasoningEffort: "medium",
    },
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsThinking: true,
    reasoningControlType: "effort",
    reasoningLevels: ["low", "medium", "high"],
    supportsSystemRole: true,
    supportsMultimodal: true,
  },
  {
    key: "openai-chat-completions",
    label: "OpenAI Compatible Chat",
    description:
      "通用 OpenAI Chat Completions 兼容协议（DeepSeek / OpenRouter / 本地代理等）。推理由模型名决定：deepseek-reasoner 输出 reasoning，deepseek-chat 不输出。返回字段：reasoning_content。",
    requestStyle: "chat.completions",
    defaultBaseURL: "",
    defaultEnvKeyName: "OPENAI_API_KEY",
    defaultSystemPromptRole: "system",
    defaultRequestOptions: {},
    supportsStreaming: true,
    supportsReasoningEffort: false,
    supportsThinking: false,
    thinkingDisableConfig: { param: "enable_thinking", value: false },
    supportsSystemRole: true,
    supportsMultimodal: false,
  },
  {
    key: "anthropic-messages",
    label: "Claude Messages",
    description:
      "Anthropic 原生 Messages API。推理控制：thinking.budget_tokens（Token 预算）。System prompt 以顶层的 system 参数注入。支持多模态。",
    requestStyle: "messages",
    defaultBaseURL: "",
    defaultEnvKeyName: "ANTHROPIC_API_KEY",
    defaultSystemPromptRole: "system",
    defaultRequestOptions: {
      thinkingEnabled: false,
      thinkingBudgetTokens: 1024,
    },
    supportsStreaming: true,
    supportsReasoningEffort: false,
    supportsThinking: true,
    reasoningControlType: "budget",
    supportsSystemRole: false,
    supportsMultimodal: true,
  },
  {
    key: "google-generative-ai",
    label: "Google Gemini",
    description:
      "Google Gemini 原生 API。推理控制：thinking_level（minimal / low / medium / high），通过 generationConfig.thinkingConfig 透传。返回字段位于 parts[].thought。",
    requestStyle: "generateContent",
    defaultBaseURL: "",
    defaultEnvKeyName: "GOOGLE_API_KEY",
    defaultSystemPromptRole: "system",
    defaultRequestOptions: {
      thinkingLevel: "high",
    },
    supportsStreaming: true,
    supportsReasoningEffort: false,
    supportsThinking: true,
    reasoningControlType: "level",
    reasoningLevels: ["minimal", "low", "medium", "high"],
    supportsSystemRole: false,
    supportsMultimodal: true,
  },
  {
    key: "doubao",
    label: "Doubao (豆包)",
    description:
      "豆包 API，OpenAI Chat Completions 兼容。推理控制：reasoning_effort（low / medium / high），通过 extra_body 透传。返回字段：reasoning_content。支持多模态。",
    requestStyle: "chat.completions",
    defaultBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
    defaultEnvKeyName: "DOUBAO_API_KEY",
    defaultSystemPromptRole: "system",
    defaultRequestOptions: {
      reasoningEffort: "medium",
    },
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsThinking: true,
    reasoningControlType: "effort",
    reasoningLevels: ["low", "medium", "high"],
    supportsSystemRole: true,
    supportsMultimodal: true,
  },
  {
    key: "glm",
    label: "GLM (智谱/Z.ai)",
    description:
      "智谱 GLM API，OpenAI Chat Completions 兼容。推理控制：reasoning_effort（low / high / max），通过 extra_body 透传。可额外开启 clear_thinking 清除推理缓存。返回字段：reasoning_content。",
    requestStyle: "chat.completions",
    defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultEnvKeyName: "GLM_API_KEY",
    defaultSystemPromptRole: "system",
    defaultRequestOptions: {
      reasoningEffort: "high",
      clearThinking: false,
    },
    supportsStreaming: true,
    supportsReasoningEffort: true,
    supportsThinking: true,
    reasoningControlType: "effort",
    reasoningLevels: ["low", "high", "max"],
    supportsSystemRole: true,
    supportsMultimodal: true,
  },
  {
    key: "kimi",
    label: "KIMI (月之暗面)",
    description:
      "月之暗面 KIMI API，OpenAI Chat Completions 兼容。推理控制：thinking_budget（Token 预算整数），通过 extra_body 透传。K2.6 后返回字段由 reasoning_content 变更为 reasoning。",
    requestStyle: "chat.completions",
    defaultBaseURL: "https://api.moonshot.cn/v1",
    defaultEnvKeyName: "KIMI_API_KEY",
    defaultSystemPromptRole: "system",
    defaultRequestOptions: {
      thinkingBudget: 0,
    },
    supportsStreaming: true,
    supportsReasoningEffort: false,
    supportsThinking: true,
    reasoningControlType: "budget",
    supportsSystemRole: true,
    supportsMultimodal: true,
  },
  {
    key: "qwen",
    label: "Qwen (通义千问)",
    description:
      "阿里通义千问 API，OpenAI Chat Completions 兼容。推理控制：enable_thinking（开关）+ thinking_budget（Token 预算），通过 extra_body 透传。返回字段：reasoning_content。",
    requestStyle: "chat.completions",
    defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultEnvKeyName: "QWEN_API_KEY",
    defaultSystemPromptRole: "system",
    defaultRequestOptions: {
      enableThinking: true,
      thinkingBudget: 0,
    },
    supportsStreaming: true,
    supportsReasoningEffort: false,
    supportsThinking: true,
    thinkingDisableConfig: { param: "enable_thinking", value: false },
    reasoningControlType: "switch+budget",
    supportsSystemRole: true,
    supportsMultimodal: true,
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
  titleModelAlias: "",
  summaryModelAlias: "",
  inviteCodeRequired: false,
  inviteCode: "",
  searchEngine: "bing_html",
  searchSourcesCollapsed: true,
  searchProviderConfigs: {},
};

export const DEFAULT_SESSION_TITLE = "\u65b0\u5bf9\u8bdd";

export const MAX_COMBO_COUNT = 10;
export const MAX_ITEM_LENGTH = 2000;

