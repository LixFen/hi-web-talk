import fs from "fs/promises";
import path from "path";
import { DATA_DIR, SESSIONS_DIR } from "../constants.js";
import {
  ensureDatabase,
  insertErrorRecord,
  upsertAdaptationRecord,
  upsertBlockRecord,
  upsertSessionRecord,
  upsertSummaryRecord,
} from "../lib/database.js";
import { ensureDir, listDirectories, readJson } from "../lib/fileStore.js";

function getSessionDir(sessionHash) {
  return path.join(SESSIONS_DIR, sessionHash);
}

function getSessionFilePath(sessionHash) {
  return path.join(getSessionDir(sessionHash), "session.json");
}

function getBlocksDir(sessionHash) {
  return path.join(getSessionDir(sessionHash), "blocks");
}

function getSummariesFilePath(sessionHash) {
  return path.join(getSessionDir(sessionHash), "summaries.json");
}

function getErrorsFilePath(sessionHash) {
  return path.join(getSessionDir(sessionHash), "errors.json");
}

function getAdaptationsFilePath(sessionHash) {
  return path.join(getSessionDir(sessionHash), "adaptations.json");
}

async function importLegacySession(sessionHash) {
  const session = await readJson(getSessionFilePath(sessionHash), null);

  if (!session) {
    return { sessions: 0, blocks: 0, summaries: 0, errors: 0, adaptations: 0 };
  }

  upsertSessionRecord(session);

  let blocks = 0;
  try {
    const entries = await fs.readdir(getBlocksDir(sessionHash), { withFileTypes: true });
    const legacyBlocks = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readJson(path.join(getBlocksDir(sessionHash), entry.name), null)),
    );

    for (const block of legacyBlocks.filter(Boolean)) {
      upsertBlockRecord(sessionHash, block);
      blocks += 1;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const summaries = await readJson(getSummariesFilePath(sessionHash), []);
  let summaryCount = 0;
  if (Array.isArray(summaries)) {
    for (const summary of summaries) {
      if (!summary?.blockSHA1) {
        continue;
      }

      upsertSummaryRecord(sessionHash, summary.blockSHA1, summary);
      summaryCount += 1;
    }
  }

  const errors = await readJson(getErrorsFilePath(sessionHash), []);
  let errorCount = 0;
  if (Array.isArray(errors)) {
    for (const error of errors) {
      insertErrorRecord({ ...error, sessionHash });
      errorCount += 1;
    }
  }

  const adaptations = await readJson(getAdaptationsFilePath(sessionHash), []);
  let adaptationCount = 0;
  if (Array.isArray(adaptations)) {
    for (const record of adaptations) {
      if (!record?.blockSHA1 || !record?.key) {
        continue;
      }

      upsertAdaptationRecord(sessionHash, record.blockSHA1, record.key, record);
      adaptationCount += 1;
    }
  }

  return {
    sessions: 1,
    blocks,
    summaries: summaryCount,
    errors: errorCount,
    adaptations: adaptationCount,
  };
}

async function main() {
  await ensureDir(DATA_DIR);
  await ensureDatabase();

  const sessionHashes = await listDirectories(SESSIONS_DIR);
  const totals = { sessions: 0, blocks: 0, summaries: 0, errors: 0, adaptations: 0 };

  for (const sessionHash of sessionHashes) {
    const result = await importLegacySession(sessionHash);
    totals.sessions += result.sessions;
    totals.blocks += result.blocks;
    totals.summaries += result.summaries;
    totals.errors += result.errors;
    totals.adaptations += result.adaptations;
  }

  console.log(
    `Migration complete: sessions=${totals.sessions}, blocks=${totals.blocks}, summaries=${totals.summaries}, errors=${totals.errors}, adaptations=${totals.adaptations}`,
  );
  console.log(`Database ready at ${path.join(DATA_DIR, "hi-web-talk.sqlite")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});