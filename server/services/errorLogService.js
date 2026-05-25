import crypto from "crypto";
import {
  deleteErrorRecordsForBlocks,
  insertErrorRecord,
  listErrorRecordsWithCount,
} from "../lib/database.js";

export async function listErrorLogs(sessionHash, options = {}) {
  return listErrorRecordsWithCount(sessionHash, options);
}

export async function appendErrorLog({
  sessionHash,
  operation,
  parentBlockSHA1 = null,
  blockSHA1 = null,
  prompt = "",
  modelAlias = "",
  error,
  meta = {},
}) {
  if (!sessionHash) {
    return null;
  }

  const logEntry = {
    logId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sessionHash,
    operation,
    parentBlockSHA1,
    blockSHA1,
    prompt,
    modelAlias,
    errorMessage: error instanceof Error ? error.message : `${error ?? "未知错误"}`,
    rawError:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack ?? "",
            status: error.status ?? null,
          }
        : { message: `${error ?? "未知错误"}` },
    meta,
  };

  insertErrorRecord(logEntry);
  return logEntry;
}


export async function deleteErrorLogsForBlocks(sessionHash, blockSHA1s = []) {
  const targetSHA1s = blockSHA1s.filter(Boolean);

  if (targetSHA1s.length === 0) {
    return 0;
  }

  const { total: beforeCount } = await listErrorLogs(sessionHash);
  deleteErrorRecordsForBlocks(sessionHash, targetSHA1s);
  const { total: afterCount } = await listErrorLogs(sessionHash);
  return beforeCount - afterCount;
}
