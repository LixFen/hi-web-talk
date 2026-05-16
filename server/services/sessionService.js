import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import {
  DEFAULT_SESSION_TITLE,
  DEFAULT_SYSTEM_PROMPT,
  SESSIONS_DIR,
} from "../constants.js";
import {
  deleteBlockRecords,
  deleteSessionRecord,
  ensureDatabase,
  listSessionRecords,
  readSessionRecord,
  upsertSessionRecord,
} from "../lib/database.js";
import { ensureDir } from "../lib/fileStore.js";
import {
  deleteAdaptationsForBlocks,
  getSessionAdaptationMap,
  projectBlockAdaptations,
} from "./blockAdaptationService.js";
import {
  createSystemRootBlock,
  deleteBlockSubtree,
  getChainBlocks,
  listBlocks,
  readBlock,
} from "./blockGraphService.js";
import { ensureConfigFiles, getAppSettings, listModels } from "./modelConfigService.js";
import { deleteErrorLogsForBlocks } from "./errorLogService.js";
import { deleteSummariesForBlocks, listSummaries } from "./summaryService.js";
import { deleteAttachmentsForBlocks } from "./attachmentService.js";
import { callProviderModel } from "./llmProviderService.js";
import { sessionDetailCache } from "../lib/cache.js";

function getSessionDir(sessionHash) {
  return path.join(SESSIONS_DIR, sessionHash);
}

function createSessionHash() {
  return crypto.randomBytes(12).toString("hex");
}

function createTitleFromPrompt(text) {
  const trimmedText = `${text ?? ""}`.trim();

  if (!trimmedText) {
    return DEFAULT_SESSION_TITLE;
  }

  return trimmedText.length > 18 ? `${trimmedText.slice(0, 18)}...` : trimmedText;
}

function buildChildrenByParent(allBlocks) {
  const childrenByParent = new Map();

  for (const block of allBlocks) {
    if (block.blockType !== "dialogue") {
      continue;
    }

    const parentKey = block.parentBlockSHA1 ?? "__root__";
    const currentChildren = childrenByParent.get(parentKey) ?? [];
    currentChildren.push(block);
    currentChildren.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    childrenByParent.set(parentKey, currentChildren);
  }

  return childrenByParent;
}

function getLatestBranchHead(blockSHA1, childrenByParent) {
  let currentSHA1 = blockSHA1;

  while (true) {
    const children = childrenByParent.get(currentSHA1) ?? [];

    if (children.length === 0) {
      return currentSHA1;
    }

    currentSHA1 = children[children.length - 1].sha1;
  }
}

function buildSummaryMap(summaryRecords) {
  return new Map(summaryRecords.map((record) => [record.blockSHA1, record]));
}

function buildBlockMap(allBlocks) {
  return new Map(allBlocks.map((block) => [block.sha1, block]));
}

function resolveActiveBlockSHA1(session, allBlocks) {
  const blockMap = buildBlockMap(allBlocks);

  if (session.activeBlockSHA1 && blockMap.has(session.activeBlockSHA1)) {
    return session.activeBlockSHA1;
  }

  const latestDialogueBlock = [...allBlocks]
    .reverse()
    .find((block) => block.blockType === "dialogue");

  if (latestDialogueBlock?.sha1) {
    return latestDialogueBlock.sha1;
  }

  if (session.rootBlockSHA1 && blockMap.has(session.rootBlockSHA1)) {
    return session.rootBlockSHA1;
  }

  return allBlocks[allBlocks.length - 1]?.sha1 ?? null;
}

function resolveFocusedBlockSHA1(session, allBlocks, resolvedActiveBlockSHA1) {
  const blockMap = buildBlockMap(allBlocks);
  const focusedBlockSHA1 = session.viewState?.focusedBlockSHA1 ?? "";

  if (focusedBlockSHA1 && blockMap.has(focusedBlockSHA1)) {
    return focusedBlockSHA1;
  }

  if (resolvedActiveBlockSHA1 && blockMap.has(resolvedActiveBlockSHA1)) {
    return resolvedActiveBlockSHA1;
  }

  return allBlocks[allBlocks.length - 1]?.sha1 ?? null;
}

function getBlockDepth(block, blockMap, depthCache = new Map()) {
  if (!block?.sha1) {
    return 0;
  }

  if (depthCache.has(block.sha1)) {
    return depthCache.get(block.sha1);
  }

  if (typeof block.meta?.depth === "number" && block.meta.depth >= 0) {
    depthCache.set(block.sha1, block.meta.depth);
    return block.meta.depth;
  }

  if (!block.parentBlockSHA1) {
    depthCache.set(block.sha1, 0);
    return 0;
  }

  const parentBlock = blockMap.get(block.parentBlockSHA1) ?? null;
  const depth = parentBlock ? getBlockDepth(parentBlock, blockMap, depthCache) + 1 : 0;
  depthCache.set(block.sha1, depth);
  return depth;
}

function buildBranchInfo(block, activeBlockSHA1, siblingsByParent, childrenByParent) {
  if (block.blockType !== "dialogue") {
    return null;
  }

  const parentKey = block.parentBlockSHA1 ?? "__root__";
  const siblings = siblingsByParent.get(parentKey) ?? [block];
  const siblingIndex = siblings.findIndex((sibling) => sibling.sha1 === block.sha1);
  const previousSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
  const nextSibling =
    siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null;
  const childBlocks = childrenByParent.get(block.sha1) ?? [];

  return {
    isActiveBlock: block.sha1 === activeBlockSHA1,
    canContinue: true,
    canRegenerate: true,
    siblingIndex: siblingIndex + 1,
    siblingCount: siblings.length,
    previousBranchHeadSHA1: previousSibling ? previousSibling.sha1 : null,
    nextBranchHeadSHA1: nextSibling ? nextSibling.sha1 : null,
    childCount: childBlocks.length,
  };
}

function buildBlockViewModels(
  allBlocks,
  activeBlockSHA1,
  focusedBlockSHA1,
  activeChainSHA1Set,
  adaptationMap,
  summaryMap,
) {
  const dialogueBlocks = allBlocks.filter((block) => block.blockType === "dialogue");
  const siblingsByParent = buildChildrenByParent(dialogueBlocks);
  const childrenByParent = buildChildrenByParent(allBlocks);
  const blockMap = buildBlockMap(allBlocks);
  const depthCache = new Map();

  return allBlocks.map((block) => {
    const summaryRecord = summaryMap.get(block.sha1) ?? null;
    const adaptationState =
      block.blockType === "dialogue"
        ? projectBlockAdaptations(adaptationMap.get(block.sha1) ?? [], summaryRecord)
        : null;
    const branchInfo = buildBranchInfo(
      block,
      activeBlockSHA1,
      siblingsByParent,
      childrenByParent,
    );
    const childBlocks = childrenByParent.get(block.sha1) ?? [];

    return {
      ...block,
      summaryInfo: summaryRecord,
      adaptationInfo: adaptationState,
      branchInfo,
      graphInfo: {
        isRoot: block.blockType === "system",
        isActiveBlock: block.sha1 === activeBlockSHA1,
        isFocusedBlock: block.sha1 === focusedBlockSHA1,
        isInActiveChain: activeChainSHA1Set.has(block.sha1),
        depth: getBlockDepth(block, blockMap, depthCache),
        childBlockSHA1s: childBlocks.map((child) => child.sha1),
        childCount: childBlocks.length,
      },
    };
  });
}

function buildChainChatMessages(chainBlocks, blockViewMap) {
  const messages = [];

  for (const block of chainBlocks) {
    if (block.blockType !== "dialogue") {
      continue;
    }

    const blockView = blockViewMap.get(block.sha1) ?? block;
    const summaryRecord = blockView.summaryInfo ?? null;
    const adaptationState = blockView.adaptationInfo ?? null;
    const branchInfo = blockView.branchInfo ?? null;

    messages.push({
      id: `${block.sha1}:user`,
      role: "user",
      text: block.prompt,
      blockSHA1: block.sha1,
      createdAt: block.createdAt,
      modelAlias: block.modelAlias,
      graphInfo: blockView.graphInfo,
    });

    messages.push({
      id: `${block.sha1}:assistant`,
      role: "assistant",
      text: block.response,
      reasoning: block.reasoning || "",
      blockSHA1: block.sha1,
      createdAt: block.createdAt,
      modelAlias: block.modelAlias,
      summaryInfo: summaryRecord,
      adaptationInfo: adaptationState,
      branchInfo,
      graphInfo: blockView.graphInfo,
    });
  }

  return messages;
}

function assertSessionDirSafe(sessionHash) {
  const targetDir = path.resolve(getSessionDir(sessionHash));
  const sessionsRoot = path.resolve(SESSIONS_DIR);

  if (!(targetDir === sessionsRoot || targetDir.startsWith(`${sessionsRoot}${path.sep}`))) {
    throw new Error("非法的会话目录路径。");
  }

  return targetDir;
}

async function ensureSessionArtifacts(sessionHash) {
  await ensureDir(getSessionDir(sessionHash));
}

export async function ensureDataLayout() {
  await ensureDir(SESSIONS_DIR);
  await ensureConfigFiles();
  await ensureDatabase();
}

export async function createSession(userId) {
  await ensureDataLayout();

  const sessionHash = createSessionHash();
  const appSettings = await getAppSettings(userId);
  const systemPrompt = appSettings.defaultSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  const rootBlock = await createSystemRootBlock(sessionHash, systemPrompt);
  const now = new Date().toISOString();

  const session = {
    sessionHash,
    title: DEFAULT_SESSION_TITLE,
    createdAt: now,
    updatedAt: now,
    rootBlockSHA1: rootBlock.sha1,
    activeBlockSHA1: rootBlock.sha1,
    viewState: {
      mode: "chat",
      focusedBlockSHA1: rootBlock.sha1,
    },
    userId,
  };

  await ensureSessionArtifacts(sessionHash);
  await upsertSessionRecord(session);

  return getSessionDetail(sessionHash);
}

export async function listSessions(userId = null) {
  await ensureDataLayout();

  return listSessionRecords(userId);
}

export async function readSession(sessionHash) {
  await ensureDataLayout();
  return readSessionRecord(sessionHash);
}

export async function getSessionOrThrow(sessionHash) {
  const session = await readSession(sessionHash);

  if (!session) {
    throw new Error(`找不到会话: ${sessionHash}`);
  }

  return session;
}

export async function updateSession(sessionHash, partialSession) {
  const currentSession = await getSessionOrThrow(sessionHash);
  const nextSession = {
    ...currentSession,
    ...partialSession,
  };

  await upsertSessionRecord(nextSession);
  sessionDetailCache.clearSession(sessionHash);
  return nextSession;
}

export async function updateSessionFocusedBlock(sessionHash, focusedBlockSHA1) {
  const currentSession = await getSessionOrThrow(sessionHash);
  const nextFocusedBlockSHA1 = `${focusedBlockSHA1 ?? ""}`.trim() || null;

  if (nextFocusedBlockSHA1) {
    const focusedBlock = await readBlock(sessionHash, nextFocusedBlockSHA1);

    if (!focusedBlock) {
      const error = new Error(`找不到目标 block: ${nextFocusedBlockSHA1}`);
      error.status = 404;
      throw error;
    }
  }

  const session = await updateSession(sessionHash, {
    updatedAt: new Date().toISOString(),
    viewState: {
      ...(currentSession.viewState ?? {}),
      focusedBlockSHA1: nextFocusedBlockSHA1,
    },
  });

  return {
    session,
    focusedBlockSHA1: nextFocusedBlockSHA1,
  };
}

export async function updateSessionTitle(sessionHash, title) {
  const nextTitle = `${title ?? ""}`.trim();

  if (!nextTitle) {
    const error = new Error("会话名称不能为空。");
    error.status = 400;
    throw error;
  }

  await updateSession(sessionHash, {
    title: nextTitle,
    updatedAt: new Date().toISOString(),
  });

  return getSessionDetail(sessionHash);
}

export async function deleteSession(sessionHash) {
  const session = await getSessionOrThrow(sessionHash);
  const targetDir = assertSessionDirSafe(sessionHash);

  deleteSessionRecord(sessionHash);
  deleteBlockRecords(sessionHash);
  await fs.rm(targetDir, { recursive: true, force: false });
  sessionDetailCache.clearSession(sessionHash);

  return {
    deletedSessionHash: sessionHash,
    deletedTitle: session.title,
  };
}

export async function deleteBlockTree(sessionHash, blockSHA1) {
  const session = await getSessionOrThrow(sessionHash);
  const targetBlock = await readBlock(sessionHash, blockSHA1);

  if (!targetBlock || targetBlock.blockType !== "dialogue") {
    const error = new Error("\u627e\u4e0d\u5230\u53ef\u5220\u9664\u7684\u5bf9\u8bdd\u5757\u3002");
    error.status = 404;
    throw error;
  }

  const deletedBlockSHA1s = await deleteBlockSubtree(sessionHash, blockSHA1);

  await Promise.all([
    deleteSummariesForBlocks(sessionHash, deletedBlockSHA1s),
    deleteAdaptationsForBlocks(sessionHash, deletedBlockSHA1s),
    deleteErrorLogsForBlocks(sessionHash, deletedBlockSHA1s),
    deleteAttachmentsForBlocks(sessionHash, deletedBlockSHA1s),
  ]);

  await updateSession(sessionHash, {
    updatedAt: new Date().toISOString(),
  });

  const detail = await getSessionDetail(sessionHash);

  return {
    session: detail.session,
    detail,
    deletedBlockSHA1s,
    deletedRootBlockSHA1: targetBlock.sha1,
    deletedCount: deletedBlockSHA1s.length,
  };
}

export async function setActiveBlock(sessionHash, blockSHA1, focusedBlockSHA1) {
  const targetBlock = await readBlock(sessionHash, blockSHA1);

  if (!targetBlock) {
    throw new Error(`找不到目标 block: ${blockSHA1}`);
  }

  const updateFields = {
    activeBlockSHA1: blockSHA1,
    updatedAt: new Date().toISOString(),
  };

  if (focusedBlockSHA1) {
    const currentSession = await getSessionOrThrow(sessionHash);
    updateFields.viewState = {
      ...(currentSession.viewState ?? {}),
      focusedBlockSHA1,
    };
  }

  await updateSession(sessionHash, updateFields);

  return getSessionDetail(sessionHash);
}

export async function updateSessionViewState(sessionHash, partialViewState, viewMode = "chat") {
  const session = await getSessionOrThrow(sessionHash);
  const nextViewState = {
    ...(session.viewState ?? {}),
    ...(partialViewState ?? {}),
  };

  if (Object.prototype.hasOwnProperty.call(partialViewState ?? {}, "focusedBlockSHA1")) {
    if (nextViewState.focusedBlockSHA1) {
      const focusedBlock = await readBlock(sessionHash, nextViewState.focusedBlockSHA1);

      if (!focusedBlock) {
        nextViewState.focusedBlockSHA1 = null;
      }
    }
  }

  await updateSession(sessionHash, {
    updatedAt: new Date().toISOString(),
    viewState: nextViewState,
  });

  return getSessionDetail(sessionHash, null, viewMode);
}

export async function getSessionDetail(sessionHash, cachedData = null, viewMode = "chat") {
  const currentSession = await getSessionOrThrow(sessionHash);
  const [allBlocks, summaryRecords, adaptationMap] = cachedData
    ? await Promise.all([
        listBlocks(sessionHash),
        Promise.resolve(cachedData.summaries ?? await listSummaries(sessionHash)),
        Promise.resolve(cachedData.adaptationMap ?? await getSessionAdaptationMap(sessionHash)),
      ])
    : await Promise.all([
        listBlocks(sessionHash),
        listSummaries(sessionHash),
        getSessionAdaptationMap(sessionHash),
      ]);

  const resolvedActiveBlockSHA1 = resolveActiveBlockSHA1(currentSession, allBlocks);
  const resolvedFocusedBlockSHA1 = resolveFocusedBlockSHA1(
    currentSession,
    allBlocks,
    resolvedActiveBlockSHA1,
  );

  const cacheKey = `${sessionHash}:${resolvedActiveBlockSHA1}:${viewMode}`;
  const cachedDetail = sessionDetailCache.get(cacheKey);

  if (cachedDetail) {
    return cachedDetail;
  }

  const needsRepair =
    (resolvedActiveBlockSHA1 && resolvedActiveBlockSHA1 !== currentSession.activeBlockSHA1) ||
    resolvedFocusedBlockSHA1 !== currentSession.viewState?.focusedBlockSHA1;
  const session = needsRepair
    ? await updateSession(sessionHash, {
        activeBlockSHA1: resolvedActiveBlockSHA1,
      viewState: {
        ...(currentSession.viewState ?? {}),
        focusedBlockSHA1: resolvedFocusedBlockSHA1,
      },
      })
    : currentSession;
  const chainBlocks = resolvedActiveBlockSHA1
    ? await getChainBlocks(sessionHash, resolvedActiveBlockSHA1, allBlocks)
    : [];
  const summaryMap = buildSummaryMap(summaryRecords);
  const activeChainSHA1Set = new Set(chainBlocks.map((block) => block.sha1));
  const blockViewModels = buildBlockViewModels(
    allBlocks,
    resolvedActiveBlockSHA1,
    resolvedFocusedBlockSHA1,
    activeChainSHA1Set,
    adaptationMap,
    summaryMap,
  );
  const blockViewMap = new Map(blockViewModels.map((block) => [block.sha1, block]));

  const baseGraph = {
    activeChainBlockSHA1s: [...activeChainSHA1Set],
    activeBlockSHA1: resolvedActiveBlockSHA1,
    focusedBlockSHA1: resolvedFocusedBlockSHA1,
    rootBlockSHA1: session.rootBlockSHA1,
  };

  let result;

  if (viewMode === "chain") {
    result = {
      session,
      activeChain: chainBlocks.map((block) => blockViewMap.get(block.sha1) ?? block),
      graph: baseGraph,
    };
  } else if (viewMode === "graph") {
    result = {
      session,
      graph: {
        ...baseGraph,
        blocks: blockViewModels,
      },
    };
  } else {
    result = {
      session,
      messages: buildChainChatMessages(chainBlocks, blockViewMap),
      activeChain: chainBlocks.map((block) => blockViewMap.get(block.sha1) ?? block),
      graph: {
        ...baseGraph,
        blocks: blockViewModels,
      },
    };
  }

  sessionDetailCache.set(cacheKey, result);
  return result;
}

export function getSuggestedSessionTitle(prompt, currentTitle) {
  if (currentTitle && currentTitle !== DEFAULT_SESSION_TITLE) {
    return currentTitle;
  }

  return createTitleFromPrompt(prompt);
}

function buildTitlePrompt(messages) {
  const dialogueMessages = messages.filter(
    (msg) => msg.role === "user" || msg.role === "assistant",
  );

  const conversationText = dialogueMessages
    .map((msg) => `${msg.role === "user" ? "用户" : "助手"}：${msg.content}`)
    .join("\n\n");

  return [
    "根据以下对话内容，生成一个简洁的中文标题（不超过 20 字）。",
    "只输出标题本身，不要加任何前缀、引号或解释。",
    "",
    conversationText,
  ].join("\n");
}

async function getChainForBlock(sessionHash, blockSHA1) {
  const chain = [];
  let currentSHA1 = blockSHA1;

  while (currentSHA1) {
    const block = await readBlock(sessionHash, currentSHA1);

    if (!block) {
      break;
    }

    chain.push(block);
    currentSHA1 = block.parentBlockSHA1;
  }

  return chain.reverse();
}

function buildTitleMessagesFromChain(chainBlocks) {
  const messages = [];

  for (const block of chainBlocks) {
    if (block.blockType !== "dialogue") {
      continue;
    }

    if (block.prompt) {
      messages.push({ role: "user", content: block.prompt });
    }

    if (block.response) {
      messages.push({ role: "assistant", content: block.response });
    }
  }

  return messages;
}

function formatChainDialogueText(messages) {
  return messages
    .map((msg) => `${msg.role === "user" ? "用户" : "助手"}：${msg.content}`)
    .join("\n\n");
}

export async function generateTitleForSession(sessionHash, { mode = "default", useChain = true, role = "user" } = {}) {
  const session = await getSessionOrThrow(sessionHash);
  const appSettings = await getAppSettings(session.userId);

  const configuredAlias = appSettings?.titleModelAlias || "";

  const allModels = await listModels(session.userId, role, { includeDisabled: false, includeSecrets: true });

  let selectedModel = null;

  if (configuredAlias) {
    selectedModel = allModels.find((m) => m.alias === configuredAlias) ?? null;

    if (!selectedModel) {
      console.error(`[generateTitleForSession] 未找到标题生成模型: ${configuredAlias}（可用模型: ${allModels.map(m => m.alias).join(", ")}）`);
    }
  } else {
    console.error("[generateTitleForSession] 未配置标题生成模型，使用首个可用模型");
  }

  if (!selectedModel) {
    selectedModel = allModels[0] ?? null;
  }

  //console.error(`[generateTitleForSession] 实际使用模型: ${selectedModel?.alias} (${selectedModel?.providerType})`);

  if (!selectedModel) {
    const error = new Error("没有可用模型，无法生成标题。");
    error.status = 400;
    throw error;
  }

  let callMessages;

  if (mode === "important") {
    const allBlocks = await listBlocks(sessionHash);
    const adaptationMap = await getSessionAdaptationMap(sessionHash);
    const dialogueBlocks = allBlocks.filter((block) => block.blockType === "dialogue");

    const importantBlocks = dialogueBlocks.filter((block) => {
      const adaptations = adaptationMap.get(block.sha1) ?? [];

      return adaptations.some((adaptation) => adaptation.key === "label.important" && adaptation.enabled);
    });

    if (importantBlocks.length === 0) {
      const error = new Error("该会话暂无标记为重要的对话块，请先在对话中标记重要内容。");
      error.status = 400;
      throw error;
    }

    const chainPromises = importantBlocks.map(async (block) => {
      const chain = await getChainForBlock(sessionHash, block.sha1);
      const chainMessages = buildTitleMessagesFromChain(chain);

      return {
        messages: chainMessages,
        length: chainMessages.length,
        headSHA1: block.sha1,
        headCreatedAt: block.createdAt,
      };
    });

    const chains = await Promise.all(chainPromises);

    chains.sort((a, b) => {
      if (a.length !== b.length) {
        return b.length - a.length;
      }

      return b.headCreatedAt.localeCompare(a.headCreatedAt);
    });

    const totalChains = chains.length;
    const chainSections = chains.map((chain, index) => {
      const label = totalChains > 1 ? `链${index + 1}：\n` : "";
      return `${label}${formatChainDialogueText(chain.messages)}`;
    });

    const conversationText = chainSections.join("\n\n---\n\n");

    callMessages = [
      {
        role: "system",
        content: "你是一个专业的对话标题生成助手，擅长从对话内容中提炼简洁准确的标题。",
      },
      {
        role: "user",
        content: [
          "以下对话内容可能包含多个分支链，每条链以「链N」标注。请提炼出对话中最重要的主题或核心问题，用一句简短的中文作为标题（不超过 20 字）。",
          "只输出标题本身，不要加任何前缀、引号或解释。",
          "",
          conversationText,
        ].join("\n"),
      },
    ];
  } else if (useChain) {
    const activeBlockSHA1 = session.activeBlockSHA1;
    let messages = [];

    if (activeBlockSHA1) {
      const chainBlocks = await getChainBlocks(sessionHash, activeBlockSHA1);
      messages = buildTitleMessagesFromChain(chainBlocks);
    }

    if (messages.length === 0) {
      const allBlocks = await listBlocks(sessionHash);
      const dialogueBlocks = allBlocks.filter((block) => block.blockType === "dialogue");

      for (const block of dialogueBlocks) {
        if (block.prompt) {
          messages.push({ role: "user", content: block.prompt });
        }

        if (block.response) {
          messages.push({ role: "assistant", content: block.response });
        }
      }
    }

    if (messages.length === 0) {
      const error = new Error("该会话暂无对话内容，无法生成标题。");
      error.status = 400;
      throw error;
    }

    callMessages = [
      {
        role: "system",
        content: "你是一个专业的对话标题生成助手，擅长从对话内容中提炼简洁准确的标题。",
      },
      {
        role: "user",
        content: buildTitlePrompt(messages),
      },
    ];
  } else {
    const allBlocks = await listBlocks(sessionHash);
    const dialogueBlocks = allBlocks.filter((block) => block.blockType === "dialogue");

    if (dialogueBlocks.length === 0) {
      const error = new Error("该会话暂无对话内容，无法生成标题。");
      error.status = 400;
      throw error;
    }

    const messages = [];

    for (const block of dialogueBlocks) {
      if (block.prompt) {
        messages.push({ role: "user", content: block.prompt });
      }

      if (block.response) {
        messages.push({ role: "assistant", content: block.response });
      }
    }

    callMessages = [
      {
        role: "system",
        content: "你是一个专业的对话标题生成助手，擅长从对话内容中提炼简洁准确的标题。",
      },
      {
        role: "user",
        content: buildTitlePrompt(messages.slice(-20)),
      },
    ];
  }

  const result = await callProviderModel({
    modelConfig: selectedModel,
    messages: callMessages,
  });

  const generatedTitle = result.reply.trim().slice(0, 50);

  if (!generatedTitle) {
    const error = new Error("生成的标题为空，请稍后再试。");
    error.status = 500;
    throw error;
  }

  await updateSessionTitle(sessionHash, generatedTitle);
  return getSessionDetail(sessionHash);
}
