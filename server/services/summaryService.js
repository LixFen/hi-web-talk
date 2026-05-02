import { DEFAULT_SYSTEM_PROMPT } from "../constants.js";
import {
  deleteSummaryRecordsForBlocks,
  listSummaryRecords,
  readSummaryRecord,
  upsertSummaryRecord,
} from "../lib/database.js";
import { readSessionRecord } from "../lib/database.js";
import { readBlock } from "./blockGraphService.js";
import { getAppSettings, listModels } from "./modelConfigService.js";
import { callProviderModel } from "./llmProviderService.js";
import { upsertBlockAdaptation } from "./blockAdaptationService.js";

function getSummaryPrompt(block) {
  return [
    "请用中文生成一段可替代原始长文本的简短摘要。",
    "要求：",
    "1. 保留用户意图、关键约束、最终结论。",
    "2. 控制在 120 字以内。",
    "3. 不要添加原文没有的新信息。",
    "4. 直接输出摘要正文，不要加标题。",
    "",
    `用户：${block.prompt}`,
    `助手：${block.response}`,
  ].join("\n");
}

function normalizeSummaryRecord(record, blockSHA1) {
  const now = new Date().toISOString();

  return {
    blockSHA1,
    status: record.status ?? "pending",
    summary: record.summary ?? "",
    errorMessage: record.errorMessage ?? "",
    modelAlias: record.modelAlias ?? "",
    provider: record.provider ?? "",
    model: record.model ?? "",
    responseId: record.responseId ?? null,
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? now,
  };
}

async function syncSummaryAdaptation(sessionHash, blockSHA1, partialRecord) {
  await upsertBlockAdaptation(sessionHash, blockSHA1, "summary.generate", {
    enabled: partialRecord.status !== "idle",
    status: partialRecord.status,
    source: partialRecord.source ?? "system",
    payload: {
      summary: partialRecord.summary ?? "",
      errorMessage: partialRecord.errorMessage ?? "",
    },
    meta: {
      modelAlias: partialRecord.modelAlias ?? "",
      provider: partialRecord.provider ?? "",
      model: partialRecord.model ?? "",
      responseId: partialRecord.responseId ?? null,
    },
  });
}

export async function listSummaries(sessionHash) {
  return listSummaryRecords(sessionHash);
}

export async function getSummaryByBlockSHA1(sessionHash, blockSHA1) {
  const summary = readSummaryRecord(sessionHash, blockSHA1);

  if (summary) {
    return summary;
  }

  const summaries = await listSummaries(sessionHash);
  return summaries.find((record) => record.blockSHA1 === blockSHA1) ?? null;
}

export async function upsertSummary(sessionHash, blockSHA1, partialRecord) {
  const existingRecord = readSummaryRecord(sessionHash, blockSHA1) ?? null;
  const nextRecord = normalizeSummaryRecord(
    {
      ...existingRecord,
      ...partialRecord,
      updatedAt: new Date().toISOString(),
    },
    blockSHA1,
  );
  upsertSummaryRecord(sessionHash, blockSHA1, nextRecord);
  await syncSummaryAdaptation(sessionHash, blockSHA1, nextRecord);

  return nextRecord;
}

export async function updateSummaryStatus(sessionHash, blockSHA1, partialRecord) {
  return upsertSummary(sessionHash, blockSHA1, partialRecord);
}

export async function deleteSummariesForBlocks(sessionHash, blockSHA1s = []) {
  const targetSHA1s = blockSHA1s.filter(Boolean);

  if (targetSHA1s.length === 0) {
    return 0;
  }

  return deleteSummaryRecordsForBlocks(sessionHash, targetSHA1s);
}

export async function generateSummaryForBlock(sessionHash, blockSHA1, modelAlias, { role = "user" } = {}) {
  const block = await readBlock(sessionHash, blockSHA1);

  if (!block || block.blockType !== "dialogue") {
    const error = new Error("找不到可摘要的对话块。");
    error.status = 404;
    throw error;
  }

  const session = await readSessionRecord(sessionHash);
  const userId = session?.userId ?? null;

  const allModels = userId
    ? await listModels(userId, role, { includeDisabled: false, includeSecrets: true })
    : [];

  let selectedModel = null;

  if (modelAlias) {
    selectedModel = allModels.find((m) => m.alias === modelAlias) ?? null;
  } else if (userId) {
    const appSettings = await getAppSettings(userId);

    if (appSettings?.summaryModelAlias) {
      selectedModel = allModels.find((m) => m.alias === appSettings.summaryModelAlias) ?? null;
    }
  }

  if (!selectedModel) {
    selectedModel = allModels[0] ?? null;
  }

  if (!selectedModel) {
    const error = new Error("没有可用模型，无法生成摘要。");
    error.status = 400;
    throw error;
  }

  await upsertSummary(sessionHash, blockSHA1, {
    status: "pending",
    summary: "",
    errorMessage: "",
    modelAlias: selectedModel.alias,
    source: "system",
  });

  try {
    const result = await callProviderModel({
      modelConfig: selectedModel,
      messages: [
        {
          role: "system",
          content:
            "你是一个负责压缩对话上下文的摘要助手。你的摘要会被后续模型继续使用，因此必须准确、简洁、可替代原文。",
        },
        {
          role: "user",
          content: getSummaryPrompt(block),
        },
      ],
    });

    return upsertSummary(sessionHash, blockSHA1, {
      status: "completed",
      summary: result.reply.trim(),
      errorMessage: "",
      modelAlias: selectedModel.alias,
      provider: result.provider,
      model: result.model,
      responseId: result.responseId,
      source: "system",
    });
  } catch (error) {
    await upsertSummary(sessionHash, blockSHA1, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : `${error ?? "未知错误"}`,
      modelAlias: selectedModel.alias,
      source: "system",
    });
    throw error;
  }
}

export function buildFallbackSummaryContext() {
  return {
    messages: [{ role: "system", content: DEFAULT_SYSTEM_PROMPT }],
    contextLength: DEFAULT_SYSTEM_PROMPT.length,
  };
}
