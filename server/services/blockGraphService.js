import crypto from "crypto";
import {
  deleteBlockRecords,
  listBlockRecords,
  readSessionBlockRecord,
  upsertBlockRecord,
} from "../lib/database.js";
import { deleteAttachmentsForBlocks } from "./attachmentService.js";

function getDefaultFlags(flags = {}) {
  return {
    ignoreInContext: false,
    summaryPinned: false,
    preferSummary: false,
    ...flags,
  };
}

function normalizeTokenUsage(tokenUsage = {}) {
  const input = Number(tokenUsage.input ?? 0);
  const output = Number(tokenUsage.output ?? 0);
  const total = Number(tokenUsage.total ?? input + output);

  return { input, output, total };
}

function buildHashPayload(block) {
  return {
    blockType: block.blockType,
    createdAt: block.createdAt,
    modelAlias: block.modelAlias,
    prompt: block.prompt,
    response: block.response,
    tokenUsage: block.tokenUsage,
    contextLength: block.contextLength,
    flags: block.flags,
    meta: block.meta,
  };
}

function createStableBlock(input) {
  const normalizedBlock = {
    blockType: input.blockType,
    createdAt: input.createdAt ?? new Date().toISOString(),
    modelAlias: input.modelAlias ?? "",
    prompt: input.prompt ?? "",
    response: input.response ?? "",
    tokenUsage: normalizeTokenUsage(input.tokenUsage),
    contextLength: Number(input.contextLength ?? 0),
    parentBlockSHA1: input.parentBlockSHA1 ?? null,
    flags: getDefaultFlags(input.flags),
    meta: input.meta ?? {},
  };

  const sha1 = crypto
    .createHash("sha1")
    .update(JSON.stringify(buildHashPayload(normalizedBlock)))
    .digest("hex");

  return {
    sha1,
    ...normalizedBlock,
  };
}

function sortBlocksByCreatedAt(blocks) {
  return [...blocks].sort((left, right) => {
    const compareResult = left.createdAt.localeCompare(right.createdAt);
    return compareResult !== 0 ? compareResult : left.sha1.localeCompare(right.sha1);
  });
}

function resolveAssistantContent(block, adaptationState, summaryRecord) {
  if (
    (adaptationState?.summaryPreferred || adaptationState?.summaryPinned) &&
    summaryRecord?.status === "completed" &&
    summaryRecord.summary
  ) {
    return `[摘要替代]\n${summaryRecord.summary}`;
  }

  return block.response;
}

export async function createSystemRootBlock(sessionHash, systemPrompt) {
  const block = createStableBlock({
    blockType: "system",
    modelAlias: "system",
    prompt: systemPrompt,
    response: "",
    parentBlockSHA1: null,
    tokenUsage: { input: 0, output: 0, total: 0 },
    contextLength: 0,
    meta: {
      kind: "system-root",
      depth: 0,
    },
  });

  await saveBlock(sessionHash, block);
  return block;
}

export async function createDialogueBlock(sessionHash, input) {
  let computedDepth = 0;
  if (input.parentBlockSHA1) {
    const parentBlock = await readBlock(sessionHash, input.parentBlockSHA1);
    computedDepth = ((parentBlock?.meta?.depth ?? 0) + 1);
  }

  const block = createStableBlock({
    blockType: "dialogue",
    createdAt: input.createdAt,
    modelAlias: input.modelAlias,
    prompt: input.prompt,
    response: input.response,
    tokenUsage: input.tokenUsage,
    contextLength: input.contextLength,
    parentBlockSHA1: input.parentBlockSHA1,
    flags: input.flags,
    meta: {
      ...input.meta,
      depth: computedDepth,
    },
  });

  await saveBlock(sessionHash, block);
  return block;
}

export async function saveBlock(sessionHash, block) {
  await upsertBlockRecord(sessionHash, block);
}

export async function readBlock(sessionHash, sha1) {
  if (!sha1) {
    return null;
  }

  const block = readSessionBlockRecord(sessionHash, sha1);

  return block;
}

export async function listBlocks(sessionHash) {
  return sortBlocksByCreatedAt(listBlockRecords(sessionHash));
}

export async function getChainBlocks(sessionHash, activeBlockSHA1) {
  const chain = [];
  let currentSHA1 = activeBlockSHA1;

  while (currentSHA1) {
    const block = await readBlock(sessionHash, currentSHA1);

    if (!block) {
      throw new Error(`找不到 block: ${currentSHA1}`);
    }

    chain.push(block);
    currentSHA1 = block.parentBlockSHA1;
  }

  return chain.reverse();
}

export async function deleteBlockSubtree(sessionHash, blockSHA1) {
  const allBlocks = await listBlocks(sessionHash);
  const targetSHA1Set = new Set();
  const pending = [blockSHA1];
  const childrenByParent = new Map();

  for (const block of allBlocks) {
    const parentKey = block.parentBlockSHA1 ?? "__root__";
    const children = childrenByParent.get(parentKey) ?? [];
    children.push(block);
    childrenByParent.set(parentKey, children);
  }

  while (pending.length > 0) {
    const currentSHA1 = pending.pop();

    if (!currentSHA1 || targetSHA1Set.has(currentSHA1)) {
      continue;
    }

    targetSHA1Set.add(currentSHA1);

    for (const child of childrenByParent.get(currentSHA1) ?? []) {
      pending.push(child.sha1);
    }
  }

  const deletedBlockSHA1s = allBlocks
    .filter((block) => targetSHA1Set.has(block.sha1))
    .map((block) => block.sha1);

  deleteBlockRecords(sessionHash, deletedBlockSHA1s);
  await deleteAttachmentsForBlocks(sessionHash, deletedBlockSHA1s);

  return deletedBlockSHA1s;
}

export function mapChainBlocksToMessages(chainBlocks, adaptationStateByBlock = new Map(), summaryMap = new Map()) {
  const messages = [];

  for (const block of chainBlocks) {
    if (block.blockType === "system") {
      if (block.prompt) {
        messages.push({
          role: "system",
          content: block.prompt,
        });
      }

      continue;
    }

    const adaptationState = adaptationStateByBlock.get(block.sha1) ?? null;
    const summaryRecord = summaryMap.get(block.sha1) ?? null;

    if (block.flags?.ignoreInContext || adaptationState?.contextIgnore) {
      continue;
    }

    messages.push({
      role: "user",
      content: block.prompt,
    });

    messages.push({
      role: "assistant",
      content: resolveAssistantContent(block, adaptationState, summaryRecord),
    });
  }

  return messages;
}
