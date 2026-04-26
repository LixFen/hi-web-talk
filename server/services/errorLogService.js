import crypto from "crypto";
import {
  deleteErrorRecordsForBlocks,
  insertErrorRecord,
  listErrorRecords,
} from "../lib/database.js";

export async function listErrorLogs(sessionHash) {
  return listErrorRecords(sessionHash);
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

  const logs = await listErrorLogs(sessionHash);
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

  const beforeCount = listErrorRecords(sessionHash).length;
  deleteErrorRecordsForBlocks(sessionHash, targetSHA1s);
  const afterCount = listErrorRecords(sessionHash).length;
  return beforeCount - afterCount;
}
