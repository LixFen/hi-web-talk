import { getSessionAdaptationMap, projectBlockAdaptations } from "./blockAdaptationService.js";
import {
  getChainBlocks,
  mapChainBlocksToMessages,
} from "./blockGraphService.js";
import { listSummaries } from "./summaryService.js";

function getContentLength(content) {
  if (typeof content === "string") {
    return content.length;
  }

  if (Array.isArray(content)) {
    return content.reduce((total, block) => {
      if (block.type === "text") {
        return total + (block.text?.length ?? 0);
      }
      return total;
    }, 0);
  }

  return String(content).length;
}

function getContextLength(messages) {
  return messages.reduce((total, message) => total + getContentLength(message.content), 0);
}

function downgradeContentToText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return String(content ?? "");
  }

  const textParts = [];

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    if (block.type === "text") {
      textParts.push(block.text ?? "");
    } else if (block.type === "image_url") {
      textParts.push("[图片]");
    } else if (block.type === "image_attachment") {
      textParts.push(`[图片: ${block.fileName ?? "附件"}]`);
    } else {
      textParts.push(`[${block.type ?? "未知内容"}]`);
    }
  }

  return textParts.join("\n");
}

export function downgradeMessagesForModel(messages, supportsMultimodal) {
  if (supportsMultimodal !== false) {
    return messages;
  }

  return messages.map((message) => ({
    ...message,
    content: downgradeContentToText(message.content),
  }));
}

export async function buildContextForActiveBlock(sessionHash, activeBlockSHA1) {
  const [chainBlocks, adaptationMap, summariesResult] = await Promise.all([
    getChainBlocks(sessionHash, activeBlockSHA1),
    getSessionAdaptationMap(sessionHash),
    listSummaries(sessionHash),
  ]);
  const summaries = summariesResult.summaries;
  const chainBlockSHA1s = new Set(chainBlocks.map((block) => block.sha1));
  const summaryMap = new Map(
    summaries.filter((record) => chainBlockSHA1s.has(record.blockSHA1)).map((record) => [record.blockSHA1, record]),
  );
  const adaptationStateByBlock = new Map();
  for (const [blockSHA1, records] of adaptationMap) {
    if (!chainBlockSHA1s.has(blockSHA1)) {
      continue;
    }
    adaptationStateByBlock.set(
      blockSHA1,
      projectBlockAdaptations(records, summaryMap.get(blockSHA1) ?? null),
    );
  }
  const messages = mapChainBlocksToMessages(chainBlocks, adaptationStateByBlock, summaryMap);

  return {
    chainBlocks,
    messages,
    contextLength: getContextLength(messages),
    summaries,
    adaptationMap,
  };
}
