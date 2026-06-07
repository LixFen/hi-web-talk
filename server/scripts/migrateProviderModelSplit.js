#!/usr/bin/env node

/**
 * 数据迁移：将扁平 Model 记录拆分为 Provider + Model
 *
 * 将现有 models.json 中的记录按 (providerType, baseURL, apiKeyEnvName) 分组，
 * 每组生成一个 Provider，组内模型添加 providerId 引用。
 *
 * 原有的 alias 保持不变，历史 block 引用安全。
 *
 * 用法：node server/scripts/migrateProviderModelSplit.js
 * 也可在服务启动时自动检测并执行。
 */

import crypto from "crypto";
import path from "path";
import { CONFIG_DIR } from "../constants.js";
import { ensureDir, pathExists, readJson, writeJson } from "../lib/fileStore.js";

const modelsFilePath = path.join(CONFIG_DIR, "models.json");
const providersFilePath = path.join(CONFIG_DIR, "providers.json");
const backupDir = path.join(CONFIG_DIR, "migration-backups");

function nowIso() {
  return new Date().toISOString();
}

function sanitizeSlug(value) {
  return `${value}`.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function buildProviderSlug(providerType, baseURL, index) {
  // Derive a readable slug from the provider type
  const typeToSlug = {
    "openai-responses": "openai",
    "openai-chat-completions": "openai-compatible",
    "anthropic-messages": "anthropic",
    "google-generative-ai": "google",
    "doubao": "doubao",
    "glm": "glm",
    "kimi": "kimi",
    "qwen": "qwen",
    "custom-openai-compatible": "custom",
  };

  let base = typeToSlug[providerType] || providerType;

  // If baseURL suggests a specific provider, use it
  if (baseURL) {
    try {
      const hostname = new URL(baseURL).hostname;
      if (hostname.includes("deepseek")) base = "deepseek";
      else if (hostname.includes("openai")) base = "openai";
      else if (hostname.includes("anthropic")) base = "anthropic";
      else if (hostname.includes("google")) base = "google";
      else if (hostname.includes("moonshot")) base = "kimi";
      else if (hostname.includes("bigmodel")) base = "glm";
      else if (hostname.includes("dashscope")) base = "qwen";
      else if (hostname.includes("volces")) base = "doubao";
      else if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) base = "local";
    } catch {
      // invalid URL, use default
    }
  }

  return sanitizeSlug(base) || `provider-${index + 1}`;
}

export async function migrateProviderModelSplit() {
  // Check if migration is needed
  if (!(await pathExists(modelsFilePath))) {
    return { migrated: false, reason: "no models.json" };
  }

  const models = await readJson(modelsFilePath, []);
  if (!Array.isArray(models) || models.length === 0) {
    return { migrated: false, reason: "empty models" };
  }

  // Check if already migrated (any model has providerId)
  if (models.some((m) => m.providerId)) {
    return { migrated: false, reason: "already migrated" };
  }

  console.log("[migrate-provider-model-split] 开始迁移...");

  // Backup
  await ensureDir(backupDir);
  const backupPath = path.join(backupDir, `models.${Date.now()}.json`);
  await writeJson(backupPath, models);
  console.log(`[migrate-provider-model-split] 备份: ${backupPath}`);

  // Group models by (providerType, baseURL, apiKeyEnvName)
  const groups = new Map();
  for (const model of models) {
    const key = JSON.stringify({
      providerType: model.providerType || "openai-chat-completions",
      baseURL: model.baseURL || "",
      apiKeyEnvName: model.apiKeyEnvName || "OPENAI_API_KEY",
      apiKeySource: model.apiKeySource || "env",
    });
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(model);
  }

  // Create providers for each group
  const providers = [];
  const providerMap = new Map(); // groupKey → providerId
  let providerIndex = 0;

  for (const [groupKey, groupModels] of groups) {
    const config = JSON.parse(groupKey);
    const firstModel = groupModels[0];

    // Generate a unique slug
    let slug = buildProviderSlug(config.providerType, config.baseURL, providerIndex);
    const existingSlugs = new Set(providers.map((p) => p.slug));
    if (existingSlugs.has(slug)) {
      slug = `${slug}-${providerIndex + 1}`;
    }

    // Derive provider name from first model's alias or providerType
    const name = firstModel.label?.split(":")[0]
      || config.providerType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      || slug;

    const provider = {
      providerId: crypto.randomUUID(),
      slug,
      name,
      providerType: config.providerType,
      baseURL: config.baseURL,
      apiKeySource: config.apiKeySource,
      apiKeyEnvName: config.apiKeyEnvName,
      apiKeyEncrypted: firstModel.apiKeyEncrypted || "",
      systemPromptRole: firstModel.systemPromptRole || "system",
      requestOptions: firstModel.requestOptions || {},
      shared: false,
      isPreset: firstModel.isPreset || false,
      meta: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    providers.push(provider);
    providerMap.set(groupKey, provider.providerId);
    providerIndex++;
  }

  // Update models with providerId reference
  const updatedModels = models.map((model) => {
    const key = JSON.stringify({
      providerType: model.providerType || "openai-chat-completions",
      baseURL: model.baseURL || "",
      apiKeyEnvName: model.apiKeyEnvName || "OPENAI_API_KEY",
      apiKeySource: model.apiKeySource || "env",
    });
    const providerId = providerMap.get(key);

    return {
      ...model,
      providerId,
      // Keep existing fields for backward compat
      // They will be inherited from provider on next normalizeModelRecord call
    };
  });

  // Write providers
  await writeJson(providersFilePath, providers);

  // Write updated models
  await writeJson(modelsFilePath, updatedModels);

  console.log(`[migrate-provider-model-split] 完成！创建 ${providers.length} 个 Provider，更新 ${updatedModels.length} 个 Model。`);

  return {
    migrated: true,
    providersCreated: providers.length,
    modelsUpdated: updatedModels.length,
    backupPath,
  };
}

// Run if called directly
if (process.argv[1] && process.argv[1].includes("migrateProviderModelSplit")) {
  migrateProviderModelSplit()
    .then((result) => {
      console.log("[migrate-provider-model-split] 结果:", result);
      process.exit(result.migrated ? 0 : 0);
    })
    .catch((error) => {
      console.error("[migrate-provider-model-split] 失败:", error);
      process.exit(1);
    });
}
