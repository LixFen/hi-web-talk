/**
 * 模型能力推断
 *
 * 优先使用构建时从 models.dev 生成的快照（5000+ 模型），
 * 快照未覆盖的模型走手动兜底列表。
 *
 * 推断结果用于预填表单，用户可自由修改。
 */

import { exactCapabilities, prefixCapabilities, snapshotGeneratedAt } from "./modelCapabilities.generated.js";

/**
 * models.dev 未覆盖的模型手动补充
 * （如国内私有模型、尚未同步到 models.dev 的新模型）
 */
const MANUAL_OVERRIDES = [
  { pattern: "doubao-1.5-thinking", supportsMultimodal: true, maxContext: 128000, supportsThinking: true },
  { pattern: "doubao-1.5-vision", supportsMultimodal: true, maxContext: 128000, supportsThinking: false },
  { pattern: "doubao", supportsMultimodal: true, maxContext: 128000, supportsThinking: false },
];

/**
 * 根据模型名推断能力
 * @param {string} modelName - 模型名称
 * @returns {object|null} 推断的能力对象，未匹配返回 null
 */
export function inferModelCapabilities(modelName) {
  if (!modelName || typeof modelName !== "string") {
    return null;
  }

  const lower = modelName.toLowerCase().trim();

  // 1. 精确匹配（生成的快照，2000+ 条）
  if (exactCapabilities[lower]) {
    return formatResult(exactCapabilities[lower]);
  }

  // 2. 前缀/家族匹配（按 pattern 长度降序，长匹配优先）
  for (const entry of prefixCapabilities) {
    if (lower.includes(entry.pattern)) {
      return formatResult(entry.capabilities);
    }
  }

  // 3. 手动兜底
  for (const entry of MANUAL_OVERRIDES) {
    if (lower.includes(entry.pattern.toLowerCase())) {
      return {
        supportsMultimodal: entry.supportsMultimodal ?? false,
        supportsThinking: entry.supportsThinking ?? false,
        maxContext: entry.maxContext ?? null,
        toolUse: entry.toolUse ?? false,
      };
    }
  }

  return null;
}

/**
 * 标准化返回格式
 */
function formatResult(caps) {
  return {
    supportsMultimodal: caps.supportsMultimodal ?? false,
    supportsThinking: caps.supportsThinking ?? false,
    maxContext: caps.maxContext ?? null,
    toolUse: caps.toolUse ?? false,
  };
}

/**
 * 获取快照生成时间（供 API 返回）
 */
export function getSnapshotInfo() {
  return { generatedAt: snapshotGeneratedAt };
}
