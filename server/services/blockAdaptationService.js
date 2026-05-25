import crypto from "crypto";
import {
  deleteAdaptationRecordsForBlocks,
  listAdaptationRecords,
  listAdaptationRecordsWithCount,
  readAdaptationRecord,
  upsertAdaptationRecord,
} from "../lib/database.js";

const BUILTIN_ADAPTATION_DEFINITIONS = [
  {
    key: "context.ignore",
    label: "忽略上下文",
    shortLabel: "忽略上下文",
    category: "context-control",
    kind: "toggle",
    description: "构造上下文时跳过这个块。",
    defaultEnabled: false,
    defaultStatus: "inactive",
    ui: { placement: "message-toolbar", order: 10 },
  },
  {
    key: "summary.prefer",
    label: "优先摘要",
    shortLabel: "优先摘要",
    category: "summary-control",
    kind: "toggle",
    description: "后续上下文构造优先使用摘要替代原始长内容。",
    defaultEnabled: false,
    defaultStatus: "inactive",
    ui: { placement: "message-toolbar", order: 20 },
  },
  {
    key: "summary.pin",
    label: "固定摘要",
    shortLabel: "固定摘要",
    category: "summary-control",
    kind: "toggle",
    description: "将该块摘要视作优先保留的上下文压缩结果。",
    defaultEnabled: false,
    defaultStatus: "inactive",
    ui: { placement: "message-toolbar", order: 30 },
  },
  {
    key: "summary.generate",
    label: "生成摘要",
    shortLabel: "生成摘要",
    category: "summary-command",
    kind: "command",
    description: "为该对话块生成或更新独立摘要记录。",
    defaultEnabled: false,
    defaultStatus: "idle",
    ui: { placement: "message-toolbar", order: 40 },
  },
  {
    key: "label.important",
    label: "重要",
    shortLabel: "重要",
    category: "label",
    kind: "toggle",
    description: "标记为重要节点，便于后续筛选与聚合。",
    defaultEnabled: false,
    defaultStatus: "inactive",
    ui: { placement: "message-toolbar", order: 50 },
  },
  {
    key: "label.review",
    label: "待整理",
    shortLabel: "待整理",
    category: "label",
    kind: "toggle",
    description: "标记为后续需要回看或整理的节点。",
    defaultEnabled: false,
    defaultStatus: "inactive",
    ui: { placement: "message-toolbar", order: 60 },
  },
];

function getDefinitionByKey(key) {
  return BUILTIN_ADAPTATION_DEFINITIONS.find((definition) => definition.key === key) ?? {
    key,
    label: key,
    shortLabel: key,
    category: "custom",
    kind: "toggle",
    description: "自定义适配项。",
    defaultEnabled: false,
    defaultStatus: "inactive",
    ui: { placement: "message-toolbar", order: 999 },
  };
}

function normalizeStatus(definition, enabled, status) {
  if (status) {
    return status;
  }

  if (definition.kind === "command") {
    return enabled ? definition.defaultStatus || "ready" : "idle";
  }

  return enabled ? "ready" : definition.defaultStatus || "inactive";
}

function normalizeAdaptationRecord(blockSHA1, definition, record = {}) {
  const now = new Date().toISOString();
  const enabled = Boolean(record.enabled ?? definition.defaultEnabled ?? false);

  return {
    adaptationId: record.adaptationId ?? crypto.randomUUID(),
    blockSHA1,
    key: definition.key,
    label: definition.label,
    shortLabel: definition.shortLabel,
    category: definition.category,
    kind: definition.kind,
    description: definition.description,
    enabled,
    status: normalizeStatus(definition, enabled, record.status),
    source: record.source ?? "user",
    config: record.config ?? {},
    payload: record.payload ?? {},
    meta: record.meta ?? {},
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? now,
  };
}

function sortAdaptations(records) {
  return [...records].sort((left, right) => {
    if (left.blockSHA1 !== right.blockSHA1) {
      return left.blockSHA1.localeCompare(right.blockSHA1);
    }

    return left.key.localeCompare(right.key);
  });
}

export function listAdaptationDefinitions() {
  return [...BUILTIN_ADAPTATION_DEFINITIONS].sort((left, right) => left.ui.order - right.ui.order);
}

export async function listSessionAdaptations(sessionHash, options = {}) {
  const { adaptations, total } = listAdaptationRecordsWithCount(sessionHash, options);
  return { adaptations: sortAdaptations(adaptations), total };
}

export async function getBlockAdaptation(sessionHash, blockSHA1, key) {
  const record = readAdaptationRecord(sessionHash, blockSHA1, key);
  if (record) {
    return record;
  }

  const { adaptations } = await listSessionAdaptations(sessionHash);
  return adaptations.find((item) => item.blockSHA1 === blockSHA1 && item.key === key) ?? null;
}

export async function listBlockAdaptations(sessionHash, blockSHA1) {
  const { adaptations } = await listSessionAdaptations(sessionHash);
  return adaptations.filter((record) => record.blockSHA1 === blockSHA1);
}

export async function upsertBlockAdaptation(sessionHash, blockSHA1, key, partialRecord = {}) {
  const definition = getDefinitionByKey(key);
  const existingRecord = readAdaptationRecord(sessionHash, blockSHA1, key) ?? null;
  const nextRecord = normalizeAdaptationRecord(blockSHA1, definition, {
    ...existingRecord,
    ...partialRecord,
    config: {
      ...(existingRecord?.config ?? {}),
      ...(partialRecord.config ?? {}),
    },
    payload: {
      ...(existingRecord?.payload ?? {}),
      ...(partialRecord.payload ?? {}),
    },
    meta: {
      ...(existingRecord?.meta ?? {}),
      ...(partialRecord.meta ?? {}),
    },
    updatedAt: new Date().toISOString(),
  });
  upsertAdaptationRecord(sessionHash, blockSHA1, key, nextRecord);
  return nextRecord;
}

export async function getSessionAdaptationMap(sessionHash) {
  const { adaptations } = await listSessionAdaptations(sessionHash);
  const map = new Map();

  for (const record of adaptations) {
    const current = map.get(record.blockSHA1) ?? [];
    current.push(record);
    map.set(record.blockSHA1, current);
  }

  return map;
}

export async function deleteAdaptationsForBlocks(sessionHash, blockSHA1s = []) {
  const targetSHA1s = blockSHA1s.filter(Boolean);

  if (targetSHA1s.length === 0) {
    return 0;
  }

  return deleteAdaptationRecordsForBlocks(sessionHash, targetSHA1s);
}

export function projectBlockAdaptations(records = [], summaryRecord = null) {
  const sortedRecords = [...records].sort((left, right) => {
    const leftOrder = getDefinitionByKey(left.key).ui.order;
    const rightOrder = getDefinitionByKey(right.key).ui.order;
    return leftOrder - rightOrder;
  });
  const byKey = Object.fromEntries(sortedRecords.map((record) => [record.key, record]));
  const activeLabels = sortedRecords
    .filter((record) => record.category === "label" && record.enabled)
    .map((record) => ({ key: record.key, label: record.shortLabel }));

  return {
    records: sortedRecords,
    byKey,
    activeKeys: sortedRecords.filter((record) => record.enabled).map((record) => record.key),
    contextIgnore: Boolean(byKey["context.ignore"]?.enabled),
    summaryPreferred: Boolean(byKey["summary.prefer"]?.enabled),
    summaryPinned: Boolean(byKey["summary.pin"]?.enabled),
    summaryGenerationStatus:
      byKey["summary.generate"]?.status ?? summaryRecord?.status ?? "idle",
    labels: activeLabels,
  };
}
