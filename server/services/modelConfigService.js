import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  CONFIG_DIR,
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODELS,
  MODEL_PROVIDER_DEFINITIONS,
} from "../constants.js";
import {
  ensureDir,
  pathExists,
  readJson,
  writeJson,
} from "../lib/fileStore.js";

const modelsFilePath = path.join(CONFIG_DIR, "models.json");
const appSettingsFilePath = path.join(CONFIG_DIR, "app-settings.json");
const modelSecretFilePath = path.join(CONFIG_DIR, ".model-config.key");

function getUserConfigDir(userId) {
  return path.join(CONFIG_DIR, "users", String(userId));
}

function getUserAppSettingsFilePath(userId) {
  return path.join(getUserConfigDir(userId), "app-settings.json");
}

function getUserModelsFilePath(userId) {
  return path.join(getUserConfigDir(userId), "models.json");
}

let cachedEncryptionKey = null;
const credentialCache = new Map();
let credentialCleanupTimer = null;

export function clearCredentialCache() {
  credentialCache.clear();
}

function scheduleCredentialCacheCleanup() {
  if (credentialCleanupTimer) {
    return;
  }
  credentialCleanupTimer = setTimeout(() => {
    credentialCache.clear();
    credentialCleanupTimer = null;
  }, 30_000);
}

function nowIso() {
  return new Date().toISOString();
}

export function getProviderDefinitionByType(providerType) {
  return MODEL_PROVIDER_DEFINITIONS.find((definition) => definition.key === providerType) ?? null;
}

function legacyProviderToType(provider) {
  if (provider === "deepseek") {
    return "openai-chat-completions";
  }

  if (provider === "openai") {
    return "openai-responses";
  }

  return provider || "openai-chat-completions";
}

function getDefaultEnvKeyName(providerType, record = {}) {
  if (record.apiKeyEnvName) {
    return record.apiKeyEnvName;
  }

  if (record.provider === "deepseek") {
    return "DEEPSEEK_API_KEY";
  }

  return getProviderDefinitionByType(providerType)?.defaultEnvKeyName || "OPENAI_API_KEY";
}

function getDefaultBaseURL(providerType, record = {}) {
  if (typeof record.baseURL === "string") {
    return record.baseURL.trim();
  }

  if (record.provider === "deepseek") {
    return "https://api.deepseek.com";
  }

  return getProviderDefinitionByType(providerType)?.defaultBaseURL || "";
}

function buildDefaultRequestOptions(providerType, record = {}) {
  const providerDefinition = getProviderDefinitionByType(providerType);
  return {
    ...(providerDefinition?.defaultRequestOptions ?? {}),
    ...(record.requestOptions ?? {}),
  };
}

function sanitizeAlias(value = "") {
  return `${value}`.trim();
}

function sanitizeOptionalText(value = "") {
  return `${value ?? ""}`.trim();
}

function encryptWithKey(plainText, key) {
  if (!plainText) {
    return "";
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptWithKey(payload, key) {
  if (!payload) {
    return "";
  }

  if (!payload.startsWith("enc:v1:")) {
    return payload;
  }

  const [, , ivBase64, tagBase64, encryptedBase64] = payload.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivBase64, "base64"),
  );

  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

async function getEncryptionKey() {
  if (cachedEncryptionKey) {
    return cachedEncryptionKey;
  }

  const envSecret = process.env.MODEL_CONFIG_MASTER_KEY?.trim();

  if (envSecret) {
    cachedEncryptionKey = crypto.createHash("sha256").update(envSecret).digest();
    return cachedEncryptionKey;
  }

  await ensureDir(CONFIG_DIR);

  if (!(await pathExists(modelSecretFilePath))) {
    const generatedSecret = crypto.randomBytes(32).toString("base64");
    await fs.writeFile(modelSecretFilePath, `${generatedSecret}\n`, "utf8");
  }

  const storedSecret = (await fs.readFile(modelSecretFilePath, "utf8")).trim();
  cachedEncryptionKey = crypto.createHash("sha256").update(storedSecret).digest();
  return cachedEncryptionKey;
}

export async function encryptApiKey(apiKey) {
  const key = await getEncryptionKey();
  return encryptWithKey(apiKey, key);
}

export async function decryptApiKey(apiKeyEncrypted) {
  if (!apiKeyEncrypted) {
    return "";
  }

  const key = await getEncryptionKey();
  return decryptWithKey(apiKeyEncrypted, key);
}

function buildConfiguredAt(record, fallbackNow) {
  return record.createdAt ?? fallbackNow;
}

async function normalizeModelRecord(record = {}, index = 0) {
  const timestamp = nowIso();

  // ── Resolve provider context ──
  // If providerId is set, inherit from the Provider entity.
  // Otherwise, use inline providerType (legacy / flat mode).
  let provider = null;
  if (record.providerId) {
    const { getProviderById } = await import("./providerConfigService.js");
    provider = await getProviderById(record.providerId);
    if (!provider) {
      const error = new Error(`找不到 providerId: ${record.providerId}`);
      error.status = 400;
      throw error;
    }
  }

  const providerType = provider
    ? provider.providerType
    : legacyProviderToType(record.providerType ?? record.provider);

  const providerDefinition = getProviderDefinitionByType(providerType);
  if (!providerDefinition) {
    const error = new Error(`不支持的 providerType: ${providerType}`);
    error.status = 400;
    throw error;
  }

  // ── Alias ──
  // Auto-generate from providerSlug:modelName when providerId is present,
  // or from providerType:modelName for legacy flat models.
  const modelName = sanitizeOptionalText(record.modelName ?? record.model);
  let alias = sanitizeAlias(record.alias);
  if (!alias) {
    if (provider) {
      alias = sanitizeAlias(`${provider.slug}:${modelName || index + 1}`);
    } else {
      alias = sanitizeAlias(`${providerType}:${modelName || index + 1}`);
    }
  }

  // ── Credential ──
  const apiKeyRaw = sanitizeOptionalText(record.apiKey ?? "");
  const apiKeyEncrypted = apiKeyRaw
    ? await encryptApiKey(apiKeyRaw)
    : sanitizeOptionalText(record.apiKeyEncrypted);

  // ── Build record ──
  // For provider-linked models: model fields override provider defaults (when non-null).
  // For legacy models: use inline fields as before.
  const base = provider ? {
    providerType: provider.providerType,
    baseURL: provider.baseURL,
    apiKeySource: provider.apiKeySource,
    apiKeyEnvName: provider.apiKeyEnvName,
    apiKeyEncrypted: provider.apiKeyEncrypted || "",
    systemPromptRole: provider.systemPromptRole,
    requestOptions: { ...(provider.requestOptions ?? {}) },
  } : {
    providerType,
    baseURL: getDefaultBaseURL(providerType, record),
    apiKeySource: record.apiKeySource === "stored" ? "stored" : "env",
    apiKeyEnvName: getDefaultEnvKeyName(providerType, record),
    apiKeyEncrypted,
    systemPromptRole:
      record.systemPromptRole || providerDefinition.defaultSystemPromptRole || "system",
    requestOptions: buildDefaultRequestOptions(providerType, record),
  };

  return {
    modelId: record.modelId ?? crypto.randomUUID(),
    alias,
    label: sanitizeOptionalText(record.label) || alias,
    providerId: record.providerId || null,
    // Provider-inherited or inline fields (model overrides take precedence)
    providerType: base.providerType,
    baseURL: record.baseURL ?? base.baseURL,
    apiKeySource: record.apiKeySource ?? base.apiKeySource,
    apiKeyEnvName: record.apiKeyEnvName ?? base.apiKeyEnvName,
    apiKeyEncrypted: apiKeyEncrypted || base.apiKeyEncrypted || "",
    modelName,
    enabled: record.enabled !== false,
    supportsStreaming: record.supportsStreaming !== false,
    systemPromptRole: record.systemPromptRole ?? base.systemPromptRole,
    supportsSystemRole:
      record.supportsSystemRole ?? providerDefinition.supportsSystemRole ?? true,
    supportsMultimodal:
      record.supportsMultimodal ?? providerDefinition.supportsMultimodal ?? true,
    supportsToolUse: Boolean(record.supportsToolUse ?? false),
    supportsThinking:
      record.supportsThinking ?? providerDefinition.supportsThinking ?? false,
    thinkingDisable:
      record.thinkingDisable ?? providerDefinition.thinkingDisableConfig ?? null,
    requestOptions: { ...(base.requestOptions ?? {}), ...(record.requestOptions ?? {}) },
    isPreset: Boolean(record.isPreset ?? false),
    shared: Boolean(record.shared ?? false),
    meta: record.meta ?? {},
    createdAt: buildConfiguredAt(record, timestamp),
    updatedAt: record.updatedAt ?? timestamp,
  };
}

function serializePublicModel(model, { configured = false } = {}) {
  return {
    modelId: model.modelId,
    alias: model.alias,
    label: model.label,
    providerId: model.providerId ?? null,
    providerType: model.providerType,
    baseURL: model.baseURL,
    apiKeySource: model.apiKeySource,
    apiKeyEnvName: model.apiKeyEnvName,
    hasStoredApiKey: Boolean(model.apiKeyEncrypted),
    credentialStatus: configured ? "configured" : "missing",
    modelName: model.modelName,
    enabled: model.enabled,
    supportsStreaming: model.supportsStreaming,
    systemPromptRole: model.systemPromptRole,
    supportsSystemRole: model.supportsSystemRole,
    supportsMultimodal: model.supportsMultimodal,
    supportsToolUse: Boolean(model.supportsToolUse ?? false),
    supportsThinking: model.supportsThinking ?? false,
    thinkingDisable: model.thinkingDisable,
    requestOptions: model.requestOptions,
    isPreset: model.isPreset,
    shared: model.shared,
    meta: model.meta,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function assertRequiredFields(payload, isCreate = false) {
  const alias = sanitizeAlias(payload.alias);
  const modelName = sanitizeOptionalText(payload.modelName);
  const hasProviderId = Boolean(payload.providerId);

  // alias: required for legacy models on create; auto-generated when providerId is present
  if (isCreate && !alias && !hasProviderId) {
    const error = new Error("alias 不能为空。可使用 provider:modelName 格式。");
    error.status = 400;
    throw error;
  }

  if (!modelName) {
    const error = new Error("modelName 不能为空。");
    error.status = 400;
    throw error;
  }

  // providerType: inherited from Provider when providerId is set
  if (!hasProviderId) {
    const providerType = legacyProviderToType(payload.providerType ?? payload.provider);
    if (!getProviderDefinitionByType(providerType)) {
      const error = new Error(`不支持的 providerType: ${providerType}`);
      error.status = 400;
      throw error;
    }
  }
}

async function readStoredModels(userId = null) {
  await ensureConfigFiles();

  if (userId != null) {
    const userModelsPath = getUserModelsFilePath(userId);

    if (await pathExists(userModelsPath)) {
      const rawModels = await readJson(userModelsPath, []);
      const sourceModels = Array.isArray(rawModels) ? rawModels : [];
      const normalizedModels = [];

      for (let index = 0; index < sourceModels.length; index += 1) {
        normalizedModels.push(await normalizeModelRecord(sourceModels[index], index));
      }

      normalizedModels.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      return normalizedModels;
    }

    return [];
  }

  const rawModels = await readJson(modelsFilePath, DEFAULT_MODELS);
  const sourceModels = Array.isArray(rawModels) ? rawModels : DEFAULT_MODELS;
  const normalizedModels = [];

  for (let index = 0; index < sourceModels.length; index += 1) {
    normalizedModels.push(await normalizeModelRecord(sourceModels[index], index));
  }

  normalizedModels.sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  if (JSON.stringify(sourceModels) !== JSON.stringify(normalizedModels)) {
    await writeJson(modelsFilePath, normalizedModels);
  }

  return normalizedModels;
}

async function writeModels(models, userId = null) {
  const normalizedModels = [];

  for (let index = 0; index < models.length; index += 1) {
    normalizedModels.push(await normalizeModelRecord(models[index], index));
  }

  normalizedModels.sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const filePath = userId != null ? getUserModelsFilePath(userId) : modelsFilePath;

  if (userId != null) {
    await ensureDir(getUserConfigDir(userId));
  }

  await writeJson(filePath, normalizedModels);
  return normalizedModels;
}

export async function ensureConfigFiles() {
  await ensureDir(CONFIG_DIR);

  if (!(await pathExists(modelsFilePath))) {
    const normalizedDefaults = [];

    for (let index = 0; index < DEFAULT_MODELS.length; index += 1) {
      normalizedDefaults.push(await normalizeModelRecord(DEFAULT_MODELS[index], index));
    }

    await writeJson(modelsFilePath, normalizedDefaults);
  }

  if (!(await pathExists(appSettingsFilePath))) {
    await writeJson(appSettingsFilePath, DEFAULT_APP_SETTINGS);
  }
}

export function listModelProviderDefinitions() {
  return MODEL_PROVIDER_DEFINITIONS;
}

export async function resolveModelCredential(model) {
  if (!model) {
    return { apiKey: "", configured: false, source: "missing" };
  }

  const cacheKey = model.alias ?? `__model_${model.modelName}`;
  const cached = credentialCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let result;

  if (model.apiKeySource === "stored" && model.apiKeyEncrypted) {
    result = {
      apiKey: await decryptApiKey(model.apiKeyEncrypted),
      configured: true,
      source: "stored",
    };
  } else {
    const envKeyName = model.apiKeyEnvName || getDefaultEnvKeyName(model.providerType, model);
    const envValue = process.env[envKeyName]?.trim() || "";

    if (envValue) {
      result = {
        apiKey: envValue,
        configured: true,
        source: `env:${envKeyName}`,
      };
    } else {
      result = { apiKey: "", configured: false, source: "missing" };
    }
  }

  scheduleCredentialCacheCleanup();
  credentialCache.set(cacheKey, result);
  return result;
}

export async function listModels(userId = null, role = "user", { includeDisabled = true, includeSecrets = false } = {}) {
  const globalModels = await readStoredModels();
  let models = globalModels;

  if (userId != null && role !== "admin") {
    const userModels = await readStoredModels(userId);
    const userAliases = new Set(userModels.map((model) => model.alias));
    const sharedGlobalModels = globalModels.filter((model) => model.shared === true).filter((model) => !userAliases.has(model.alias));
    models = [...sharedGlobalModels, ...userModels];
  }

  const filteredModels = includeDisabled
    ? models
    : models.filter((model) => model.enabled !== false);

  if (includeSecrets) {
    return filteredModels;
  }

  const publicModels = [];

  for (const model of filteredModels) {
    const credential = await resolveModelCredential(model);
    publicModels.push(serializePublicModel(model, { configured: credential.configured }));
  }

  return publicModels;
}

export async function listEnabledModels(userId = null, role = "user") {
  return listModels(userId, role, { includeDisabled: false, includeSecrets: true });
}

export async function getModelByAlias(alias, userId = null, role = "user") {
  if (userId != null) {
    const userModels = await readStoredModels(userId);
    const userModel = userModels.find((model) => model.alias === alias);
    if (userModel) {
      return userModel;
    }
  }

  const globalModels = await readStoredModels();
  const globalModel = globalModels.find((model) => model.alias === alias) ?? null;

  if (globalModel && role !== "admin" && !globalModel.shared) {
    return null;
  }

  return globalModel;
}

export async function createModel(payload, userId = null, role = "user") {
  assertRequiredFields(payload, true);

  const isAdmin = role === "admin";
  const targetUserId = isAdmin ? null : userId;
  const models = await readStoredModels(targetUserId);

  // normalizeModelRecord auto-generates alias when providerId is set
  const nextModel = await normalizeModelRecord(
    {
      ...payload,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    models.length,
  );

  let alias = nextModel.alias;

  // Auto-disambiguate: append -N when alias collides and user didn't specify one explicitly
  if (models.some((model) => model.alias === alias)) {
    if (!payload.alias) {
      let counter = 2;
      while (models.some((model) => model.alias === `${alias}-${counter}`)) {
        counter++;
      }
      alias = `${alias}-${counter}`;
      nextModel.alias = alias;
    } else {
      const error = new Error(`模型 alias 已存在: ${alias}`);
      error.status = 409;
      throw error;
    }
  }

  const nextModels = await writeModels([...models, nextModel], targetUserId);
  return nextModels.find((model) => model.alias === alias) ?? nextModel;
}

export async function updateModel(alias, payload, userId = null, role = "user") {
  const isAdmin = role === "admin";
  const targetUserId = isAdmin ? null : userId;
  const models = await readStoredModels(targetUserId);
  const currentModel = models.find((model) => model.alias === alias) ?? null;

  if (!currentModel) {
    if (!isAdmin && userId != null) {
      const globalModels = await readStoredModels();
      const globalModel = globalModels.find((model) => model.alias === alias);
      if (globalModel) {
        const error = new Error("不能修改共享模型。");
        error.status = 403;
        throw error;
      }
    }

    const error = new Error(`找不到模型: ${alias}`);
    error.status = 404;
    throw error;
  }

  if (payload.alias && sanitizeAlias(payload.alias) !== alias) {
    const error = new Error("当前版本暂不允许修改 alias，以保护历史 block 失去稳定引用。");
    error.status = 400;
    throw error;
  }

  const sanitizedPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

  const mergedRecord = {
    ...currentModel,
    ...sanitizedPayload,
    alias,
    updatedAt: nowIso(),
  };

  assertRequiredFields(mergedRecord);

  const nextModel = await normalizeModelRecord(
    mergedRecord,
    models.findIndex((model) => model.alias === alias),
  );
  const nextModels = await writeModels(
    models.map((model) => (model.alias === alias ? nextModel : model)),
    targetUserId,
  );

  return nextModels.find((model) => model.alias === alias) ?? nextModel;
}

export async function deleteModel(alias, userId = null, role = "user") {
  const isAdmin = role === "admin";
  const targetUserId = isAdmin ? null : userId;
  const models = await readStoredModels(targetUserId);
  const targetModel = models.find((model) => model.alias === alias) ?? null;

  if (!targetModel) {
    if (!isAdmin && userId != null) {
      const globalModels = await readStoredModels();
      const globalModel = globalModels.find((model) => model.alias === alias);
      if (globalModel) {
        const error = new Error("不能删除共享模型。");
        error.status = 403;
        throw error;
      }
    }

    const error = new Error(`找不到模型: ${alias}`);
    error.status = 404;
    throw error;
  }

  const nextModels = models.filter((model) => model.alias !== alias);
  await writeModels(nextModels, targetUserId);
  return targetModel;
}

export async function getModelHealthReport() {
  const models = await readStoredModels();
  const report = [];

  for (const model of models) {
    const credential = await resolveModelCredential(model);
    report.push({
      alias: model.alias,
      label: model.label,
      providerType: model.providerType,
      enabled: model.enabled,
      credentialSource: credential.source,
      configured: credential.configured,
      modelName: model.modelName,
      baseURL: model.baseURL,
    });
  }

  return report;
}

export async function getAppSettings(userId = null) {
  await ensureConfigFiles();

  if (userId != null) {
    const userSettingsPath = getUserAppSettingsFilePath(userId);

    if (await pathExists(userSettingsPath)) {
      return (await readJson(userSettingsPath, DEFAULT_APP_SETTINGS)) ?? DEFAULT_APP_SETTINGS;
    }
  }

  return (await readJson(appSettingsFilePath, DEFAULT_APP_SETTINGS)) ?? DEFAULT_APP_SETTINGS;
}

export async function updateAppSettings(partialSettings = {}, userId = null) {
  await ensureConfigFiles();

  const filePath = userId != null ? getUserAppSettingsFilePath(userId) : appSettingsFilePath;

  if (userId != null) {
    await ensureDir(getUserConfigDir(userId));
  }

  const currentSettings =
    (await readJson(filePath, DEFAULT_APP_SETTINGS)) ?? DEFAULT_APP_SETTINGS;
  const nextSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...currentSettings,
  };

  if (Object.prototype.hasOwnProperty.call(partialSettings, "showChatFocusOutline")) {
    nextSettings.showChatFocusOutline = partialSettings.showChatFocusOutline !== false;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "hideWideScreenSideBranches")) {
    nextSettings.hideWideScreenSideBranches = partialSettings.hideWideScreenSideBranches === true;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "showChatAdaptationButtons")) {
    nextSettings.showChatAdaptationButtons = partialSettings.showChatAdaptationButtons !== false;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "showContextIgnoreButton")) {
    nextSettings.showContextIgnoreButton = partialSettings.showContextIgnoreButton !== false;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "showSummaryPreferButton")) {
    nextSettings.showSummaryPreferButton = partialSettings.showSummaryPreferButton !== false;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "showSummaryPinButton")) {
    nextSettings.showSummaryPinButton = partialSettings.showSummaryPinButton !== false;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "showSummaryGenerateButton")) {
    nextSettings.showSummaryGenerateButton = partialSettings.showSummaryGenerateButton !== false;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "showImportantLabelButton")) {
    nextSettings.showImportantLabelButton = partialSettings.showImportantLabelButton !== false;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "showPendingOrganizeLabelButton")) {
    nextSettings.showPendingOrganizeLabelButton =
      partialSettings.showPendingOrganizeLabelButton !== false;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "titleModelAlias")) {
    nextSettings.titleModelAlias = `${partialSettings.titleModelAlias ?? ""}`.trim();
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "summaryModelAlias")) {
    nextSettings.summaryModelAlias = `${partialSettings.summaryModelAlias ?? ""}`.trim();
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "autoGenerateTitle")) {
    nextSettings.autoGenerateTitle = partialSettings.autoGenerateTitle === true;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "darkMode")) {
    nextSettings.darkMode = partialSettings.darkMode;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "inviteCodeRequired")) {
    nextSettings.inviteCodeRequired = partialSettings.inviteCodeRequired === true;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "inviteCode")) {
    nextSettings.inviteCode = `${partialSettings.inviteCode ?? ""}`.trim();
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "searchEngine")) {
    const validEngines = ["bing_html", "brave", "bing", "google", "searxng"];
    if (validEngines.includes(partialSettings.searchEngine)) {
      nextSettings.searchEngine = partialSettings.searchEngine;
    }
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "searchSourcesCollapsed")) {
    nextSettings.searchSourcesCollapsed = partialSettings.searchSourcesCollapsed === true;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "searchProviderConfigs")) {
    nextSettings.searchProviderConfigs = partialSettings.searchProviderConfigs;
  }

  await writeJson(filePath, nextSettings);
  return nextSettings;
}

export function createLegacyModelConfig(provider, modelName) {
  if (provider === "deepseek") {
    return {
      alias: `deepseek:${modelName || "deepseek-chat"}`,
      label: "DeepSeek Legacy",
      providerType: "openai-chat-completions",
      baseURL: "https://api.deepseek.com",
      apiKeySource: "env",
      apiKeyEnvName: "DEEPSEEK_API_KEY",
      apiKeyEncrypted: "",
      modelName: modelName || "deepseek-chat",
      enabled: true,
      supportsStreaming: true,
      systemPromptRole: "system",
      supportsSystemRole: true,
      supportsMultimodal: false,
      requestOptions: {},
      isPreset: true,
      meta: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      modelId: crypto.randomUUID(),
    };
  }

  return {
    alias: `openai:${modelName || "gpt-5-mini-2025-08-07"}`,
    label: "OpenAI Legacy",
    providerType: "openai-responses",
    baseURL: "",
    apiKeySource: "env",
    apiKeyEnvName: "OPENAI_API_KEY",
    apiKeyEncrypted: "",
    modelName: modelName || "gpt-5-mini-2025-08-07",
      enabled: true,
      supportsStreaming: true,
      systemPromptRole: "developer",
      supportsSystemRole: true,
      supportsMultimodal: true,
      requestOptions: {
        reasoningEffort: "low",
      },
    isPreset: true,
    meta: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
    modelId: crypto.randomUUID(),
  };
}
