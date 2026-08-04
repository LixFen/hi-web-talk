import crypto from "crypto";
import path from "path";
import {
  CONFIG_DIR,
  MODEL_PROVIDER_DEFINITIONS,
} from "../constants.js";
import {
  ensureDir,
  pathExists,
  readJson,
  writeJson,
} from "../lib/fileStore.js";
import { encryptApiKey, decryptApiKey } from "./modelConfigService.js";
import { normalizeResponsesBaseURL } from "./providerAdapters/responsesBaseURL.js";

const providersFilePath = path.join(CONFIG_DIR, "providers.json");

function getUserConfigDir(userId) {
  return path.join(CONFIG_DIR, "users", String(userId));
}

function getUserProvidersFilePath(userId) {
  return path.join(getUserConfigDir(userId), "providers.json");
}

function nowIso() {
  return new Date().toISOString();
}

// ── Provider Definition helpers ──

export function getProviderDefinitionByType(providerType) {
  return MODEL_PROVIDER_DEFINITIONS.find((d) => d.key === providerType) ?? null;
}

export function listProviderDefinitions() {
  return MODEL_PROVIDER_DEFINITIONS;
}

// ── Internal helpers ──

function sanitizeSlug(value = "") {
  return `${value}`.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function sanitizeText(value = "") {
  return `${value ?? ""}`.trim();
}

async function normalizeProviderRecord(record = {}) {
  const timestamp = nowIso();
  const providerType = record.providerType || "openai-chat-completions";
  const definition = getProviderDefinitionByType(providerType);

  if (!definition) {
    const error = new Error(`不支持的 providerType: ${providerType}`);
    error.status = 400;
    throw error;
  }

  const slug = sanitizeSlug(record.slug || "");
  if (!slug) {
    const error = new Error("slug 不能为空。");
    error.status = 400;
    throw error;
  }

  const apiKeyRaw = sanitizeText(record.apiKey ?? "");
  const apiKeyEncrypted = apiKeyRaw
    ? await encryptApiKey(apiKeyRaw)
    : sanitizeText(record.apiKeyEncrypted);

  return {
    providerId: record.providerId || crypto.randomUUID(),
    slug,
    name: sanitizeText(record.name) || slug,
    providerType,
    baseURL: providerType === "openai-responses"
      ? normalizeResponsesBaseURL(sanitizeText(record.baseURL) || definition.defaultBaseURL || "")
      : sanitizeText(record.baseURL) || definition.defaultBaseURL || "",
    apiKeySource: record.apiKeySource === "stored" ? "stored" : "env",
    apiKeyEnvName: sanitizeText(record.apiKeyEnvName) || definition.defaultEnvKeyName || "OPENAI_API_KEY",
    apiKeyEncrypted,
    systemPromptRole: record.systemPromptRole || definition.defaultSystemPromptRole || "system",
    requestOptions: { ...(definition.defaultRequestOptions ?? {}), ...(record.requestOptions ?? {}) },
    shared: Boolean(record.shared ?? false),
    isPreset: Boolean(record.isPreset ?? false),
    meta: record.meta ?? {},
    createdAt: record.createdAt || timestamp,
    updatedAt: record.updatedAt || timestamp,
  };
}

function serializePublicProvider(provider, { configured = false } = {}) {
  return {
    providerId: provider.providerId,
    slug: provider.slug,
    name: provider.name,
    providerType: provider.providerType,
    baseURL: provider.baseURL,
    apiKeySource: provider.apiKeySource,
    apiKeyEnvName: provider.apiKeyEnvName,
    hasStoredApiKey: Boolean(provider.apiKeyEncrypted),
    credentialStatus: configured ? "configured" : "missing",
    systemPromptRole: provider.systemPromptRole,
    requestOptions: provider.requestOptions,
    shared: provider.shared,
    isPreset: provider.isPreset,
    meta: provider.meta,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

function assertRequiredProviderFields(payload, isCreate = false) {
  if (isCreate && !sanitizeSlug(payload.slug)) {
    const error = new Error("slug 不能为空，仅允许小写字母、数字、下划线和连字符。");
    error.status = 400;
    throw error;
  }

  if (!sanitizeText(payload.name) && !isCreate) {
    // name 不强制（update 时可省略）
  }

  const providerType = payload.providerType || "openai-chat-completions";
  if (!getProviderDefinitionByType(providerType)) {
    const error = new Error(`不支持的 providerType: ${providerType}`);
    error.status = 400;
    throw error;
  }
}

// ── Storage ──

async function ensureProvidersFile() {
  await ensureDir(CONFIG_DIR);
  if (!(await pathExists(providersFilePath))) {
    await writeJson(providersFilePath, []);
  }
}

async function readStoredProviders(userId = null) {
  await ensureProvidersFile();

  const filePath = userId != null ? getUserProvidersFilePath(userId) : providersFilePath;

  if (userId != null && !(await pathExists(filePath))) {
    return [];
  }

  const raw = await readJson(filePath, []);
  const records = Array.isArray(raw) ? raw : [];
  const normalized = [];

  for (const record of records) {
    normalized.push(await normalizeProviderRecord(record));
  }

  normalized.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return normalized;
}

async function writeProviders(providers, userId = null) {
  const normalized = [];
  for (const p of providers) {
    normalized.push(await normalizeProviderRecord(p));
  }
  normalized.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const filePath = userId != null ? getUserProvidersFilePath(userId) : providersFilePath;
  if (userId != null) {
    await ensureDir(getUserConfigDir(userId));
  }
  await writeJson(filePath, normalized);
  return normalized;
}

// ── Public API ──

export async function listProviders(userId = null, role = "user", { includeSecrets = false } = {}) {
  const globalProviders = await readStoredProviders();
  let providers = globalProviders;

  if (userId != null && role !== "admin") {
    const userProviders = await readStoredProviders(userId);
    const userSlugs = new Set(userProviders.map((p) => p.slug));
    const sharedGlobal = globalProviders
      .filter((p) => p.shared === true)
      .filter((p) => !userSlugs.has(p.slug));
    providers = [...sharedGlobal, ...userProviders];
  }

  if (includeSecrets) {
    return providers;
  }

  const publicProviders = [];
  for (const provider of providers) {
    const credential = await resolveProviderCredential(provider);
    publicProviders.push(serializePublicProvider(provider, { configured: credential.configured }));
  }
  return publicProviders;
}

export async function getProviderById(providerId, userId = null, role = "user") {
  const providers = await readStoredProviders(userId);
  const found = providers.find((p) => p.providerId === providerId) ?? null;

  if (!found && userId != null && role !== "admin") {
    // Check global shared
    const globalProviders = await readStoredProviders();
    const global = globalProviders.find((p) => p.providerId === providerId);
    if (global && global.shared) return global;
  }

  return found;
}

export async function getProviderBySlug(slug, userId = null, role = "user") {
  const providers = await readStoredProviders(userId);
  const found = providers.find((p) => p.slug === slug) ?? null;

  if (!found && userId != null && role !== "admin") {
    const globalProviders = await readStoredProviders();
    const global = globalProviders.find((p) => p.slug === slug);
    if (global && global.shared) return global;
  }

  return found;
}

export async function createProvider(payload, userId = null, role = "user") {
  assertRequiredProviderFields(payload, true);

  const isAdmin = role === "admin";
  const targetUserId = isAdmin ? null : userId;
  const providers = await readStoredProviders(targetUserId);
  const slug = sanitizeSlug(payload.slug);

  if (providers.some((p) => p.slug === slug)) {
    const error = new Error(`Provider slug 已存在: ${slug}`);
    error.status = 409;
    throw error;
  }

  const newProvider = await normalizeProviderRecord({
    ...payload,
    slug,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const nextProviders = await writeProviders([...providers, newProvider], targetUserId);
  return nextProviders.find((p) => p.slug === slug) ?? newProvider;
}

export async function updateProvider(providerId, payload, userId = null, role = "user") {
  const isAdmin = role === "admin";
  const targetUserId = isAdmin ? null : userId;
  const providers = await readStoredProviders(targetUserId);
  const existing = providers.find((p) => p.providerId === providerId) ?? null;

  if (!existing) {
    if (!isAdmin && userId != null) {
      const globalProviders = await readStoredProviders();
      const global = globalProviders.find((p) => p.providerId === providerId);
      if (global) {
        const error = new Error("不能修改共享 Provider。");
        error.status = 403;
        throw error;
      }
    }
    const error = new Error(`找不到 Provider: ${providerId}`);
    error.status = 404;
    throw error;
  }

  // slug 不可修改
  if (payload.slug && sanitizeSlug(payload.slug) !== existing.slug) {
    const error = new Error("slug 不可修改。");
    error.status = 400;
    throw error;
  }

  const sanitizedPayload = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined),
  );

  const merged = {
    ...existing,
    ...sanitizedPayload,
    providerId,
    slug: existing.slug,
    updatedAt: nowIso(),
  };

  assertRequiredProviderFields(merged);

  const nextProvider = await normalizeProviderRecord(merged);
  const nextProviders = await writeProviders(
    providers.map((p) => (p.providerId === providerId ? nextProvider : p)),
    targetUserId,
  );

  return nextProviders.find((p) => p.providerId === providerId) ?? nextProvider;
}

export async function deleteProvider(providerId, userId = null, role = "user") {
  const isAdmin = role === "admin";
  const targetUserId = isAdmin ? null : userId;
  const providers = await readStoredProviders(targetUserId);
  const existing = providers.find((p) => p.providerId === providerId) ?? null;

  if (!existing) {
    if (!isAdmin && userId != null) {
      const globalProviders = await readStoredProviders();
      const global = globalProviders.find((p) => p.providerId === providerId);
      if (global) {
        const error = new Error("不能删除共享 Provider。");
        error.status = 403;
        throw error;
      }
    }
    const error = new Error(`找不到 Provider: ${providerId}`);
    error.status = 404;
    throw error;
  }

  // ── Cascade: disassociate models linked to this provider ──
  const { readStoredModels, writeModels } = await import("./modelConfigService.js");
  try {
    const models = await readStoredModels(targetUserId);
    const linkedModels = models.filter((m) => m.providerId === providerId);
    if (linkedModels.length > 0) {
      const disassociated = models.map((m) => {
        if (m.providerId !== providerId) return m;
        // Copy provider-level settings inline, clear providerId
        return {
          ...m,
          providerId: null,
          providerType: m.providerType || existing.providerType,
          baseURL: m.baseURL || existing.baseURL,
          apiKeySource: m.apiKeySource || existing.apiKeySource,
          apiKeyEnvName: m.apiKeyEnvName || existing.apiKeyEnvName,
          apiKeyEncrypted: m.apiKeyEncrypted || existing.apiKeyEncrypted || "",
          systemPromptRole: m.systemPromptRole || existing.systemPromptRole,
          requestOptions: { ...(existing.requestOptions ?? {}), ...(m.requestOptions ?? {}) },
          updatedAt: new Date().toISOString(),
        };
      });
      await writeModels(disassociated, targetUserId);
    }
  } catch (cascadeError) {
    console.warn("[deleteProvider] cascade model cleanup failed:", cascadeError.message);
  }

  const nextProviders = providers.filter((p) => p.providerId !== providerId);
  await writeProviders(nextProviders, targetUserId);
  return existing;
}

// ── Credential resolution ──

const providerCredentialCache = new Map();
let providerCredentialCleanupTimer = null;

function scheduleProviderCredentialCacheCleanup() {
  if (providerCredentialCleanupTimer) return;
  providerCredentialCleanupTimer = setTimeout(() => {
    providerCredentialCache.clear();
    providerCredentialCleanupTimer = null;
  }, 30_000);
}

export async function resolveProviderCredential(provider) {
  if (!provider) {
    return { apiKey: "", configured: false, source: "missing" };
  }

  const cacheKey = `prov:${provider.providerId ?? provider.slug}`;
  const cached = providerCredentialCache.get(cacheKey);
  if (cached) return cached;

  let result;

  if (provider.apiKeySource === "stored" && provider.apiKeyEncrypted) {
    result = {
      apiKey: await decryptApiKey(provider.apiKeyEncrypted),
      configured: true,
      source: "stored",
    };
  } else {
    const envKeyName = provider.apiKeyEnvName || "OPENAI_API_KEY";
    const envValue = process.env[envKeyName]?.trim() || "";
    if (envValue) {
      result = { apiKey: envValue, configured: true, source: `env:${envKeyName}` };
    } else {
      result = { apiKey: "", configured: false, source: "missing" };
    }
  }

  scheduleProviderCredentialCacheCleanup();
  providerCredentialCache.set(cacheKey, result);
  return result;
}

export function clearProviderCredentialCache() {
  providerCredentialCache.clear();
}

export { normalizeProviderRecord };
