#!/usr/bin/env node

/**
 * 构建时抓取 models.dev API，生成模型能力快照
 *
 * 用法：node scripts/fetchModelCapabilities.js
 * 输出：server/services/modelCapabilities.generated.js
 *
 * 在 `npm run build` 时自动执行，也可单独运行手动刷新。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, "../server/services/modelCapabilities.generated.js");
const API_URL = "https://models.dev/api.json";
const TIMEOUT_MS = 15_000;

async function main() {
  console.log(`[fetch-model-capabilities] 正在从 ${API_URL} 抓取模型数据...`);

  let data;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(API_URL, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    data = await response.json();
  } catch (error) {
    console.error(`[fetch-model-capabilities] 抓取失败: ${error.message}`);
    console.error("[fetch-model-capabilities] 将跳过生成，使用已有的快照文件（如有）。");

    // 如果已有生成文件则不删除，保证构建不中断
    if (fs.existsSync(OUTPUT_PATH)) {
      console.log("[fetch-model-capabilities] 已有快照文件保留不变。");
      process.exit(0);
    } else {
      console.error("[fetch-model-capabilities] 无已有快照文件，构建可能受影响。");
      process.exit(1);
    }
  }

  // ── 提取模型能力 ──

  /** @type {Record<string, object>} */
  const exactCapabilities = {};
  /** @type {Array<{pattern: string, capabilities: object}>} */
  const prefixEntries = new Map(); // pattern → capabilities（去重）

  let totalModels = 0;

  const MIN_PATTERN_LENGTH = 5;

  for (const [providerKey, provider] of Object.entries(data)) {
    const models = provider?.models;
    if (!models || typeof models !== "object") continue;

    for (const [modelId, model] of Object.entries(models)) {
      totalModels++;

      const capabilities = extractCapabilities(model);
      if (!capabilities) continue;

      // 精确匹配：使用模型 ID（小写）
      const normalizedId = modelId.toLowerCase();
      exactCapabilities[normalizedId] = capabilities;

      // 前缀匹配：提取基础模型名（去掉日期后缀和版本号变体）
      const basePatterns = extractBasePatterns(modelId, model.family);
      for (const pattern of basePatterns) {
        const key = pattern.toLowerCase();
        // 过滤过短的 pattern，避免误匹配（如 "o" 匹配 "unknown"）
        if (key.length < MIN_PATTERN_LENGTH) continue;
        // 长 pattern 优先（更精确的匹配），相同 pattern 取已有的
        if (!prefixEntries.has(key) || key.length > prefixEntries.get(key).pattern.length) {
          prefixEntries.set(key, { pattern: key, capabilities });
        }
      }
    }
  }

  // 前缀匹配按 pattern 长度降序排列（长匹配优先）
  const prefixCapabilities = [...prefixEntries.values()].sort(
    (a, b) => b.pattern.length - a.pattern.length
  );

  // ── 生成文件 ──

  const generatedAt = new Date().toISOString();
  const content = generateFileContent(generatedAt, exactCapabilities, prefixCapabilities);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, content, "utf8");

  const exactCount = Object.keys(exactCapabilities).length;
  const prefixCount = prefixCapabilities.length;
  console.log(
    `[fetch-model-capabilities] 完成！扫描 ${totalModels} 个模型，` +
    `生成 ${exactCount} 条精确匹配、${prefixCount} 条前缀匹配。`
  );
  console.log(`[fetch-model-capifications] 输出: ${OUTPUT_PATH}`);
}

/**
 * 从 models.dev 模型条目提取能力
 */
function extractCapabilities(model) {
  if (!model || typeof model !== "object") return null;

  const inputModalities = model.modalities?.input ?? [];
  const supportsMultimodal = inputModalities.some(
    (m) => m === "image" || m === "video" || m === "audio"
  );

  return {
    supportsMultimodal,
    supportsThinking: model.reasoning === true,
    maxContext: model.limit?.context ?? null,
    maxOutput: model.limit?.output ?? null,
    toolUse: model.tool_call === true,
  };
}

/**
 * 从模型 ID 和 family 提取用于前缀匹配的基础名称
 *
 * 例如：
 *   "claude-sonnet-4-20250514" → ["claude-sonnet-4", "claude-sonnet"]
 *   "gpt-4o-2024-08-06"       → ["gpt-4o"]
 *   "gemini-2.5-flash"         → ["gemini-2.5-flash", "gemini-2.5"]
 */
function extractBasePatterns(modelId, family) {
  const patterns = [];
  const lower = modelId.toLowerCase();

  // 1. 去掉日期后缀（-2024-08-06, -20250514 等）
  const withoutDate = lower.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
  if (withoutDate !== lower) {
    patterns.push(withoutDate);
  }

  // 2. 去掉版本号后缀（-v1, -v2, -latest 等）
  const withoutVersion = withoutDate.replace(/-v\d+$/, "").replace(/-latest$/, "");
  if (withoutVersion !== withoutDate) {
    patterns.push(withoutVersion);
  }

  // 3. family 作为更宽泛的匹配
  if (family && typeof family === "string") {
    const familyLower = family.toLowerCase();
    if (!patterns.includes(familyLower) && lower.startsWith(familyLower)) {
      patterns.push(familyLower);
    }
  }

  // 4. 至少包含原始 ID
  if (!patterns.includes(lower)) {
    patterns.push(lower);
  }

  return [...new Set(patterns)];
}

/**
 * 生成 JavaScript 模块内容
 */
function generateFileContent(generatedAt, exactCapabilities, prefixCapabilities) {
  const lines = [
    "// Auto-generated by scripts/fetchModelCapabilities.js — DO NOT EDIT",
    `// Source: ${API_URL}`,
    `// Generated at: ${generatedAt}`,
    "",
    `export const snapshotGeneratedAt = ${JSON.stringify(generatedAt)};`,
    "",
    "/**",
    " * 精确匹配表：model ID（小写）→ 能力对象",
    " */",
    `export const exactCapabilities = ${JSON.stringify(exactCapabilities, null, 2)};`,
    "",
    "/**",
    " * 前缀/家族匹配表：按 pattern 长度降序排列（长匹配优先）",
    " */",
    `export const prefixCapabilities = ${JSON.stringify(prefixCapabilities, null, 2)};`,
    "",
  ];

  return lines.join("\n");
}

main().catch((error) => {
  console.error("[fetch-model-capabilities] 未捕获的错误:", error);
  process.exit(1);
});
