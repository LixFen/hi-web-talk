import { getSessionAdaptationMap, projectBlockAdaptations } from "./blockAdaptationService.js";
import {
  getChainBlocks,
  mapChainBlocksToMessages,
} from "./blockGraphService.js";
import { listSummaries } from "./summaryService.js";

function getContextLength(messages) {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

export async function buildContextForActiveBlock(sessionHash, activeBlockSHA1) {
  const [chainBlocks, adaptationMap, summaries] = await Promise.all([
    getChainBlocks(sessionHash, activeBlockSHA1),
    getSessionAdaptationMap(sessionHash),
    listSummaries(sessionHash),
  ]);
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
