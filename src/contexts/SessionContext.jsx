import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  branchFromBlock,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  regenerateBlock,
  regenerateSessionTitle,
  runBlockAdaptationCommand,
  setActiveBlock,
  setFocusedBlock,
  updateBlockAdaptation,
  updateSessionTitle,
  updateSessionViewState,
} from "../lib/chatApi";
import { useAuth } from "./AuthContext";
import { useApp } from "./AppContext";
import useStreaming from "../hooks/useStreaming";

const SessionContext = createContext(null);

function upsertSessionSummary(currentSessions, nextSession) {
  const filteredSessions = currentSessions.filter(
    (session) => session.sessionHash !== nextSession.sessionHash,
  );
  return [nextSession, ...filteredSessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function resolveViewMode(detail, fallback = "chat") {
  return detail?.session?.viewState?.mode || fallback;
}

function resolveFocusedBlockSHA1(detail, fallback = "") {
  return detail?.session?.viewState?.focusedBlockSHA1 || fallback;
}

const SESSION_DETAIL_CACHE = new Map();
const SESSION_CACHE_MAX = 3;
const SESSION_CACHE_TTL = 5 * 60 * 1000;

function getFromCache(sessionHash) {
  const entry = SESSION_DETAIL_CACHE.get(sessionHash);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > SESSION_CACHE_TTL) {
    SESSION_DETAIL_CACHE.delete(sessionHash);
    return null;
  }
  const keys = Array.from(SESSION_DETAIL_CACHE.keys());
  if (keys.length > SESSION_CACHE_MAX) {
    for (let i = 0; i < keys.length - SESSION_CACHE_MAX; i++) {
      SESSION_DETAIL_CACHE.delete(keys[i]);
    }
  }
  return entry.detail;
}

function setToCache(sessionHash, detail) {
  const keys = Array.from(SESSION_DETAIL_CACHE.keys());
  if (keys.length >= SESSION_CACHE_MAX) {
    SESSION_DETAIL_CACHE.delete(keys[0]);
  }
  SESSION_DETAIL_CACHE.set(sessionHash, { detail, timestamp: Date.now() });
}

export function SessionProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const { selectedModel } = useApp();

  const [sessionSummaries, setSessionSummaries] = useState([]);
  const [activeSessionDetail, setActiveSessionDetail] = useState(null);
  const [viewMode, setViewMode] = useState("chat");
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitchingView, setIsSwitchingView] = useState(false);
  const [error, setError] = useState("");
  const [chatNavigationRequest, setChatNavigationRequest] = useState(null);
  const [focusedBlockSHA1State, setFocusedBlockSHA1State] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const activeSessionHashRef = useRef("");
  const viewSwitchVersionRef = useRef(0);
  const chatNavigationRequestIdRef = useRef(0);

  const issueChatNavigationRequest = useCallback(
    (reason, behavior = "auto", targetBlockSHA1 = "") => {
      chatNavigationRequestIdRef.current += 1;
      setChatNavigationRequest({
        id: chatNavigationRequestIdRef.current,
        reason,
        behavior,
        targetBlockSHA1,
      });
    },
    [],
  );

  const handleChatNavigationRequestHandled = useCallback((requestId) => {
    setChatNavigationRequest((currentRequest) =>
      currentRequest?.id === requestId ? null : currentRequest,
    );
  }, []);

  const applySessionDetail = useCallback(
    (detail, options = {}) => {
      const nextSessionHash = detail?.session?.sessionHash ?? "";
      const nextFocusedBlockSHA1 = resolveFocusedBlockSHA1(detail, "");
      const isSameSession =
        activeSessionHashRef.current &&
        activeSessionHashRef.current === nextSessionHash;

      setActiveSessionDetail((prev) => {
        if (!prev) return detail;
        const merged = { ...prev };
        for (const key of Object.keys(detail)) {
          const val = detail[key];
          if (
            val &&
            typeof val === "object" &&
            !Array.isArray(val) &&
            prev[key] &&
            typeof prev[key] === "object" &&
            !Array.isArray(prev[key])
          ) {
            merged[key] = { ...prev[key], ...val };
          } else {
            merged[key] = val;
          }
        }
        return merged;
      });
      setFocusedBlockSHA1State((currentFocused) =>
        isSameSession && currentFocused ? currentFocused : nextFocusedBlockSHA1,
      );
      activeSessionHashRef.current = nextSessionHash;
      if (!options.preserveViewMode) {
        setViewMode(resolveViewMode(detail, viewMode));
      }
      setSessionSummaries((currentSessions) =>
        upsertSessionSummary(currentSessions, detail.session),
      );
      if (options.revealLatestInChat) {
        issueChatNavigationRequest(options.reason, options.behavior);
      }
      if (nextSessionHash) {
        setToCache(nextSessionHash, detail);
      }
    },
    [viewMode, issueChatNavigationRequest],
  );

  const activeConversation = activeSessionDetail?.session ?? null;
  const messages = activeSessionDetail?.messages ?? [];
  const activeChainBlocks = activeSessionDetail?.activeChain ?? [];
  const graph = activeSessionDetail?.graph ?? {
    blocks: [],
    activeBlockSHA1: "",
    rootBlockSHA1: "",
    activeChainBlockSHA1s: [],
  };

  const blocks = graph.blocks ?? [];
  const activeBlockSHA1 = graph.activeBlockSHA1 ?? "";

  const focusedBlockSHA1 = useMemo(
    () =>
      focusedBlockSHA1State ||
      resolveFocusedBlockSHA1(activeSessionDetail, graph.activeBlockSHA1),
    [focusedBlockSHA1State, activeSessionDetail, graph.activeBlockSHA1],
  );

  const handleFocusBlock = useCallback(
    async (blockSHA1) => {
      const sessionHash = activeSessionDetail?.session?.sessionHash;
      if (!sessionHash || !blockSHA1 || isLoading) return;
      if (blockSHA1 === focusedBlockSHA1) return;
      setError("");
      setFocusedBlockSHA1State(blockSHA1);
      try {
        await setFocusedBlock(sessionHash, blockSHA1);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "更新焦点失败，请稍后再试。",
        );
      }
    },
    [activeSessionDetail, isLoading, focusedBlockSHA1],
  );

  const handleSelectBlock = useCallback(
    (sha1) => {
      if (!sha1 || sha1 === focusedBlockSHA1) return;
      issueChatNavigationRequest("block-selector", "smooth", sha1);
    },
    [focusedBlockSHA1, issueChatNavigationRequest],
  );

  const handleNewChat = useCallback(async () => {
    if (isLoading) return;
    setError("");
    try {
      const detail = await createSession();
      applySessionDetail(detail);
      return detail;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "创建会话失败，请稍后再试。",
      );
      return null;
    }
  }, [isLoading, applySessionDetail]);

  const loadSessionDetail = useCallback(
    async (sessionHash) => {
      const cached = getFromCache(sessionHash);
      if (cached) return cached;
      const detail = await getSession(sessionHash);
      setToCache(sessionHash, detail);
      return detail;
    },
    [],
  );

  const handleSelectConversation = useCallback(
    async (sessionHash) => {
      if (isLoading) return;
      setError("");
      try {
        const detail = await loadSessionDetail(sessionHash);
        applySessionDetail(detail, {
          reason: "select-session",
          behavior: "auto",
        });
        return detail;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "读取会话失败，请稍后再试。",
        );
        return null;
      }
    },
    [isLoading, loadSessionDetail, applySessionDetail],
  );

  const handleDeleteConversation = useCallback(
    async (conversation) => {
      if (!conversation?.id || isLoading) return null;
      const confirmed = window.confirm(
        `确认删除会话《${conversation.title || "未命名会话"}》吗？\n\n这会同时删除该会话下的 block、摘要、错误日志和适配记录，且无法撤销。`,
      );
      if (!confirmed) return null;
      setIsLoading(true);
      setError("");
      try {
        const result = await deleteSession(conversation.id);
        const remainingSessions = result.sessions ?? [];
        setSessionSummaries(remainingSessions);
        let nextHash = null;
        if (activeSessionDetail?.session?.sessionHash === conversation.id) {
          if (remainingSessions.length > 0) {
            nextHash = remainingSessions[0].sessionHash;
            const detail = await getSession(nextHash);
            applySessionDetail(detail, {
              reason: "delete-fallback-session",
              behavior: "auto",
            });
          } else {
            setActiveSessionDetail(null);
            setViewMode("chat");
          }
        }
        return { nextHash, remainingCount: remainingSessions.length };
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "删除会话失败，请稍后再试。",
        );
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, activeSessionDetail, applySessionDetail],
  );

  const handleRenameConversation = useCallback(
    async (conversation, nextTitle) => {
      if (!conversation?.id || isLoading) return;
      const trimmedTitle = `${nextTitle ?? ""}`.trim();
      if (!trimmedTitle || trimmedTitle === conversation.title) return;
      setError("");
      try {
        const detail = await updateSessionTitle(conversation.id, trimmedTitle);
        if (activeSessionDetail?.session?.sessionHash === conversation.id) {
          applySessionDetail(detail);
          return;
        }
        setSessionSummaries((currentSessions) =>
          upsertSessionSummary(currentSessions, detail.session),
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "更新会话名称失败，请稍后再试。",
        );
        throw err;
      }
    },
    [isLoading, activeSessionDetail, applySessionDetail],
  );

  const handleRegenerateTitle = useCallback(
    async (conversation, mode = "default", useChain = true) => {
      if (!conversation?.id || isLoading) return;
      setError("");
      setIsLoading(true);
      try {
        const detail = await regenerateSessionTitle(conversation.id, {
          mode,
          useChain,
        });
        if (activeSessionDetail?.session?.sessionHash === conversation.id) {
          applySessionDetail(detail);
        } else {
          setSessionSummaries((currentSessions) =>
            upsertSessionSummary(currentSessions, detail.session),
          );
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "重新生成标题失败，请稍后再试。",
        );
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, activeSessionDetail, applySessionDetail],
  );

  const currentViewMode =
    activeSessionDetail?.session?.viewState?.mode || viewMode;

  const handleChangeViewMode = useCallback(
    (nextMode) => {
      if (!nextMode || nextMode === currentViewMode) return;
      const previousMode = currentViewMode;
      setViewMode(nextMode);
      setError("");
      setIsSwitchingView(true);
      const sessionHash = activeSessionDetail?.session?.sessionHash;
      if (!sessionHash) {
        setIsSwitchingView(false);
        return;
      }
      const version = ++viewSwitchVersionRef.current;
      updateSessionViewState(sessionHash, nextMode)
        .then((detail) => {
          if (version !== viewSwitchVersionRef.current) return;
          applySessionDetail(detail, {
            reason: "switch-to-chat",
            behavior: "auto",
          });
        })
        .catch((err) => {
          if (version !== viewSwitchVersionRef.current) return;
          setViewMode(previousMode);
          setError(
            err instanceof Error ? err.message : "切换视图失败，请稍后再试。",
          );
        })
        .finally(() => {
          if (version === viewSwitchVersionRef.current) {
            setIsSwitchingView(false);
          }
        });
    },
    [currentViewMode, activeSessionDetail, applySessionDetail],
  );

  const handleActivateBlock = useCallback(
    async (blockSHA1) => {
      const sessionHash = activeSessionDetail?.session?.sessionHash;
      if (!sessionHash || isLoading) return;
      setError("");
      setFocusedBlockSHA1State(blockSHA1);
      try {
        await setFocusedBlock(sessionHash, blockSHA1);
        const detail = await setActiveBlock(sessionHash, blockSHA1);
        applySessionDetail(detail, {
          reason: "activate-block",
          behavior: "auto",
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "切换分支失败，请稍后再试。",
        );
      }
    },
    [activeSessionDetail, isLoading, applySessionDetail],
  );

  const handleBranchFromBlock = useCallback(
    async (blockSHA1) => {
      const sessionHash = activeSessionDetail?.session?.sessionHash;
      if (!sessionHash || isLoading) return;
      setError("");
      try {
        const detail = await branchFromBlock({
          sessionHash,
          blockSHA1,
        });
        applySessionDetail(detail, {
          reason: "branch-from-block",
          behavior: "auto",
        });
        await setFocusedBlock(sessionHash, blockSHA1);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "创建分支失败，请稍后再试。",
        );
      }
    },
    [activeSessionDetail, isLoading, applySessionDetail],
  );

  const handleRegenerate = useCallback(
    async (blockSHA1) => {
      const sessionHash = activeSessionDetail?.session?.sessionHash;
      if (!sessionHash || !selectedModel || isLoading) return;
      setIsLoading(true);
      setError("");
      try {
        const detail = await regenerateBlock({
          sessionHash,
          blockSHA1,
          modelAlias: selectedModel.alias,
        });
        applySessionDetail(detail, {
          reason: "regenerate-block",
          behavior: "auto",
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "重新生成失败，请稍后再试。",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [activeSessionDetail, selectedModel, isLoading, applySessionDetail],
  );

  const handleToggleAdaptation = useCallback(
    async (blockSHA1, key, enabled) => {
      const sessionHash = activeSessionDetail?.session?.sessionHash;
      if (!sessionHash || isLoading) return;
      setIsLoading(true);
      setError("");
      try {
        const result = await updateBlockAdaptation({
          sessionHash,
          blockSHA1,
          key,
          enabled,
        });
        applySessionDetail(result.detail);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "更新适配项失败，请稍后再试。",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [activeSessionDetail, isLoading, applySessionDetail],
  );

  const handleRunAdaptation = useCallback(
    async (blockSHA1, key) => {
      const sessionHash = activeSessionDetail?.session?.sessionHash;
      if (!sessionHash || isLoading) return;
      setIsLoading(true);
      setError("");
      try {
        const result = await runBlockAdaptationCommand({
          sessionHash,
          blockSHA1,
          key,
          modelAlias: selectedModel?.alias,
        });
        applySessionDetail(result.detail);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "执行适配命令失败，请稍后再试。",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [activeSessionDetail, isLoading, selectedModel, applySessionDetail],
  );

  const getSessionHash = useCallback(() => {
    return activeSessionDetail?.session?.sessionHash || "";
  }, [activeSessionDetail]);

  const {
    streamingReply,
    streamingReasoning,
    pendingPrompt,
    abortControllerRef,
    subscribeToStream,
    handleSend,
    handleStopStreaming,
    handleUploadAttachment,
  } = useStreaming({
    getSessionHash,
    selectedModel,
    onApplyDetail: applySessionDetail,
    onSetLoading: setIsLoading,
    onSetError: (msg) => setError(msg),
  });

  useEffect(() => {
    if (!isAuthenticated) {
      setSessionSummaries([]);
      setActiveSessionDetail(null);
      setViewMode("chat");
      setIsBootstrapping(false);
      return;
    }

    let isCancelled = false;

    async function bootstrap() {
      setIsBootstrapping(true);
      setError("");
      try {
        const { sessions } = await listSessions();
        if (isCancelled) return;
        setSessionSummaries(sessions);

        if (sessions.length === 0) {
          setActiveSessionDetail(null);
          setViewMode("chat");
          return;
        }

        const cached = getFromCache(sessions[0].sessionHash);
        const detail = cached || (await getSession(sessions[0].sessionHash));
        if (isCancelled) return;
        applySessionDetail(detail, {
          reason: "bootstrap",
          behavior: "auto",
        });
        subscribeToStream(sessions[0].sessionHash);
      } catch (err) {
        if (!isCancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "初始化失败，请检查服务端是否已启动。",
          );
        }
      } finally {
        if (!isCancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    bootstrap();

    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated]);

  const pendingUserAlreadyPersisted = useMemo(
    () =>
      messages.some(
        (message) => message.role === "user" && message.text === pendingPrompt,
      ),
    [messages, pendingPrompt],
  );

  const pendingAssistantAlreadyPersisted = useMemo(
    () =>
      (Boolean(streamingReply) || Boolean(streamingReasoning)) &&
      messages.some(
        (message) =>
          message.role === "assistant" &&
          message.text === streamingReply &&
          (message.reasoning || "") === streamingReasoning,
      ),
    [messages, streamingReply, streamingReasoning],
  );

  const shouldShowPendingUserMessage =
    Boolean(pendingPrompt) && !pendingUserAlreadyPersisted;
  const shouldShowPendingAssistantMessage =
    (Boolean(streamingReply) || Boolean(streamingReasoning)) &&
    !pendingAssistantAlreadyPersisted &&
    (!pendingUserAlreadyPersisted ||
      Boolean(streamingReply) ||
      Boolean(streamingReasoning));
  const isReplyPending =
    shouldShowPendingUserMessage || shouldShowPendingAssistantMessage;

  const displayMessages = useMemo(
    () =>
      shouldShowPendingUserMessage || shouldShowPendingAssistantMessage
        ? [
            ...messages,
            ...(shouldShowPendingUserMessage
              ? [
                  {
                    id: "pending-user-message",
                    role: "user",
                    text: pendingPrompt,
                  },
                ]
              : []),
            ...(shouldShowPendingAssistantMessage
              ? [
                  {
                    id: "pending-assistant-message",
                    role: "assistant",
                    text: streamingReply,
                    reasoning: streamingReasoning,
                  },
                ]
              : []),
          ]
        : messages,
    [
      messages,
      pendingPrompt,
      streamingReply,
      streamingReasoning,
      shouldShowPendingUserMessage,
      shouldShowPendingAssistantMessage,
    ],
  );

  const hasStartedConversation = displayMessages.length > 0;

  const value = useMemo(
    () => ({
      sessionSummaries,
      activeSessionDetail,
      activeConversation,
      messages,
      activeChainBlocks,
      graph,
      blocks,
      activeBlockSHA1,
      focusedBlockSHA1,
      viewMode,
      currentViewMode,
      isLoading,
      isSwitchingView,
      isBootstrapping,
      error,
      streamingReply,
      streamingReasoning,
      pendingPrompt,
      isReplyPending,
      displayMessages,
      hasStartedConversation,
      chatNavigationRequest,
      abortControllerRef,
      setError,
      newChat: handleNewChat,
      selectConversation: handleSelectConversation,
      deleteConversation: handleDeleteConversation,
      renameConversation: handleRenameConversation,
      regenerateTitle: handleRegenerateTitle,
      changeViewMode: handleChangeViewMode,
      activateBlock: handleActivateBlock,
      focusBlock: handleFocusBlock,
      selectBlock: handleSelectBlock,
      branchFromBlock: handleBranchFromBlock,
      regenerate: handleRegenerate,
      toggleAdaptation: handleToggleAdaptation,
      runAdaptation: handleRunAdaptation,
      send: handleSend,
      stopStreaming: handleStopStreaming,
      uploadAttachment: handleUploadAttachment,
      subscribeToStream,
      applySessionDetail,
      issueChatNavigationRequest,
      handleChatNavigationRequestHandled,
    }),
    [
      sessionSummaries,
      activeSessionDetail,
      activeConversation,
      messages,
      activeChainBlocks,
      graph,
      blocks,
      activeBlockSHA1,
      focusedBlockSHA1,
      viewMode,
      currentViewMode,
      isLoading,
      isSwitchingView,
      isBootstrapping,
      error,
      streamingReply,
      streamingReasoning,
      pendingPrompt,
      isReplyPending,
      displayMessages,
      hasStartedConversation,
      chatNavigationRequest,
      abortControllerRef,
      handleNewChat,
      handleSelectConversation,
      handleDeleteConversation,
      handleRenameConversation,
      handleRegenerateTitle,
      handleChangeViewMode,
      handleActivateBlock,
      handleFocusBlock,
      handleSelectBlock,
      handleBranchFromBlock,
      handleRegenerate,
      handleToggleAdaptation,
      handleRunAdaptation,
      handleSend,
      handleStopStreaming,
      handleUploadAttachment,
      subscribeToStream,
      applySessionDetail,
      issueChatNavigationRequest,
      handleChatNavigationRequestHandled,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}

export default SessionContext;
