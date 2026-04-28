import { useEffect, useMemo, useRef, useState } from "react";
import ChainCardView from "./components/ChainCardView";
import ChatComposer from "./components/ChatComposer";
import ChatHero from "./components/ChatHero";
import ChatView from "./components/ChatView";
import GraphView from "./components/GraphView";
import AppearanceSettingsPanel from "./components/AppearanceSettingsPanel";
import InteractionSettingsPanel from "./components/InteractionSettingsPanel";
import LoginView from "./components/LoginView";
import ModelSettingsPanel from "./components/ModelSettingsPanel";
import SettingsMenuPanel from "./components/SettingsMenuPanel";
import Sidebar from "./components/Sidebar";
import ViewModeSwitcher from "./components/ViewModeSwitcher";
import {
  branchFromBlock,
  createModelConfig,
  createSession,
  deleteModelConfig,
  deleteSession,
  getAppSettings,
  getCurrentUser,
  getSession,
  listAdaptationDefinitions,
  listModelProviderDefinitions,
  listModels,
  listSessions,
  regenerateBlock,
  runBlockAdaptationCommand,
  sendReply,
  sendReplyStream,
  setActiveBlock,
  setFocusedBlock,
  updateAppSettings,
  updateSessionTitle,
  updateBlockAdaptation,
  updateModelConfig,
  updateSessionViewState,
} from "./lib/chatApi";
import {
  getStoredUser,
  getToken,
  setStoredUser,
  setToken,
  clearStoredUser,
  clearToken,
} from "./lib/tokenStore";
import "./styles/app.css";
import hljsGithubDark from "highlight.js/styles/github-dark.css?url";

function upsertSessionSummary(currentSessions, nextSession) {
  const filteredSessions = currentSessions.filter(
    (session) => session.sessionHash !== nextSession.sessionHash,
  );

  return [nextSession, ...filteredSessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function pickEnabledModelAlias(models, preferredAlias = "") {
  const enabledModels = models.filter((model) => model.enabled !== false);

  if (enabledModels.length === 0) {
    return "";
  }

  return (
    enabledModels.find((model) => model.alias === preferredAlias)?.alias ||
    enabledModels[0].alias
  );
}

function resolveViewMode(detail, fallback = "chat") {
  return detail?.session?.viewState?.mode || fallback;
}

function resolveFocusedBlockSHA1(detail, fallback = "") {
  return detail?.session?.viewState?.focusedBlockSHA1 || fallback;
}

function resolveLayoutMode(viewportWidth) {
  if (viewportWidth < 600) {
    return "mobile";
  }

  if (viewportWidth <= 1280) {
    return "tablet";
  }

  return "desktop";
}

export default function App() {
  const [sessionSummaries, setSessionSummaries] = useState([]);
  const [activeSessionDetail, setActiveSessionDetail] = useState(null);
  const [modelOptions, setModelOptions] = useState([]);
  const [providerDefinitions, setProviderDefinitions] = useState([]);
  const [adaptationDefinitions, setAdaptationDefinitions] = useState([]);
  const [appSettings, setAppSettings] = useState({});
  const [selectedModelId, setSelectedModelId] = useState(() => {
    try {
      return localStorage.getItem("hi-web-talk:selectedModelId") || "";
    } catch {
      return "";
    }
  });
  const [viewMode, setViewMode] = useState("chat");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isModelPanelOpen, setIsModelPanelOpen] = useState(false);
  const [isAppearancePanelOpen, setIsAppearancePanelOpen] = useState(false);
  const [isInteractionPanelOpen, setIsInteractionPanelOpen] = useState(false);
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [isAppearanceSaving, setIsAppearanceSaving] = useState(false);
  const [isInteractionSaving, setIsInteractionSaving] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [streamingReply, setStreamingReply] = useState("");
  const [error, setError] = useState("");
  const [chatNavigationRequest, setChatNavigationRequest] = useState(null);
  const [isComposerCollapsed, setIsComposerCollapsed] = useState(false);
  const [focusedBlockSHA1State, setFocusedBlockSHA1State] = useState("");
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [isSidebarDrawerOpen, setIsSidebarDrawerOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getToken() && getStoredUser()));
  const isAdmin = currentUser?.role === "admin";
  const chatNavigationRequestIdRef = useRef(0);
  const activeSessionHashRef = useRef("");
  const streamAbortControllerRef = useRef(null);
  const streamBufferRef = useRef("");
  const streamFlushRafRef = useRef(0);
  const drawerTouchStartRef = useRef({ x: 0, y: 0, active: false });
  const drawerSwipeDetectedRef = useRef(false);

  const layoutMode = resolveLayoutMode(viewportWidth);
  const showSidebarMenuButton = layoutMode !== "desktop";

  function handleLogin(user, token) {
    setToken(token);
    setStoredUser(user);
    setCurrentUser(user);
    setIsAuthenticated(true);
    setError("");
  }

  function handleLogout() {
    clearToken();
    clearStoredUser();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setActiveSessionDetail(null);
    setSessionSummaries([]);
    setModelOptions([]);
    setError("");
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setIsBootstrapping(false);
      return;
    }

    let isDisposed = false;

    async function bootstrap() {
      setIsBootstrapping(true);
      setError("");

      try {
        const [
          { models },
          { sessions },
          { definitions },
          { definitions: providerDefs },
          { settings },
        ] = await Promise.all([
          listModels(),
          listSessions(),
          listAdaptationDefinitions(),
          listModelProviderDefinitions(),
          getAppSettings(),
        ]);

        if (isDisposed) {
          return;
        }

        setModelOptions(models);
        setProviderDefinitions(providerDefs);
        setAdaptationDefinitions(definitions);
        setAppSettings(settings ?? {});
        setSelectedModelId((currentModelId) =>
          pickEnabledModelAlias(models, currentModelId),
        );
        setSessionSummaries(sessions);

        if (sessions.length === 0) {
          setActiveSessionDetail(null);
          setViewMode("chat");
          return;
        }

        const detail = await getSession(sessions[0].sessionHash);

        if (isDisposed) {
          return;
        }

        applySessionDetail(detail, {
          reason: "bootstrap",
          behavior: "auto",
        });
      } catch (requestError) {
        if (!isDisposed) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "初始化失败，请检查服务端是否已启动。",
          );
        }
      } finally {
        if (!isDisposed) {
          setIsBootstrapping(false);
        }
      }
    }

    bootstrap();

    return () => {
      isDisposed = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (layoutMode === "desktop") {
      setIsSidebarCollapsed(false);
      setIsSidebarDrawerOpen(false);
      return;
    }

    setIsSidebarCollapsed(true);
  }, [layoutMode]);

  useEffect(() => {
    try {
      localStorage.setItem("hi-web-talk:selectedModelId", selectedModelId);
    } catch {
      // ignore storage errors
    }
  }, [selectedModelId]);

  useEffect(() => {
    const darkMode = appSettings.darkMode || "system";
    const html = document.documentElement;
    const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function syncTheme() {
      if (darkMode === "dark") {
        html.setAttribute("data-theme", "dark");
      } else if (darkMode === "light") {
        html.setAttribute("data-theme", "light");
      } else {
        html.removeAttribute("data-theme");
      }

      let link = document.getElementById("hljs-dark-theme");
      const shouldUseDark =
        darkMode === "dark" ||
        (darkMode !== "light" && darkMediaQuery.matches);

      if (shouldUseDark) {
        if (!link) {
          link = document.createElement("link");
          link.id = "hljs-dark-theme";
          link.rel = "stylesheet";
          link.href = hljsGithubDark;
          document.head.appendChild(link);
        } else {
          link.disabled = false;
        }
      } else if (link) {
        link.disabled = true;
      }
    }

    syncTheme();

    try {
      localStorage.setItem("hi-web-talk:darkMode", darkMode);
    } catch {
      // ignore storage errors
    }

    if (darkMode === "system") {
      darkMediaQuery.addEventListener("change", syncTheme);
      return () => darkMediaQuery.removeEventListener("change", syncTheme);
    }
  }, [appSettings.darkMode]);

  const activeConversation = activeSessionDetail?.session ?? null;
  const messages = activeSessionDetail?.messages ?? [];
  const activeChainBlocks = activeSessionDetail?.activeChain ?? [];
  const graph = activeSessionDetail?.graph ?? {
    blocks: [],
    activeBlockSHA1: "",
    rootBlockSHA1: "",
    activeChainBlockSHA1s: [],
  };
  const bottomDockMode = appSettings.bottomDockMode || "smart";
  const showChatFocusOutline = appSettings.showChatFocusOutline !== false;
  const hideWideScreenSideBranches = appSettings.hideWideScreenSideBranches === true;
  const showChatAdaptationButtons = appSettings.showChatAdaptationButtons !== false;
  const chatAdaptationButtonVisibility = useMemo(
    () => ({
      enabled: showChatAdaptationButtons,
      byKey: {
        "context.ignore": appSettings.showContextIgnoreButton !== false,
        "summary.prefer": appSettings.showSummaryPreferButton !== false,
        "summary.pin": appSettings.showSummaryPinButton !== false,
        "summary.generate": appSettings.showSummaryGenerateButton !== false,
        "label.important": appSettings.showImportantLabelButton !== false,
        "label.review": appSettings.showPendingOrganizeLabelButton !== false,
      },
    }),
    [
      appSettings.showContextIgnoreButton,
      appSettings.showImportantLabelButton,
      appSettings.showPendingOrganizeLabelButton,
      appSettings.showSummaryGenerateButton,
      appSettings.showSummaryPinButton,
      appSettings.showSummaryPreferButton,
      showChatAdaptationButtons,
    ],
  );
  const enabledModels = useMemo(() => modelOptions.filter((option) => option.enabled !== false), [modelOptions]);
  const pendingUserAlreadyPersisted = useMemo(
    () => messages.some((message) => message.role === "user" && message.text === pendingPrompt),
    [messages, pendingPrompt],
  );
  const pendingAssistantAlreadyPersisted = useMemo(
    () =>
      Boolean(streamingReply) &&
      messages.some(
        (message) =>
          message.role === "assistant" &&
          message.text === streamingReply,
      ),
    [messages, streamingReply],
  );
  const shouldShowPendingUserMessage = Boolean(pendingPrompt) && !pendingUserAlreadyPersisted;
  const shouldShowPendingAssistantMessage =
    Boolean(streamingReply) &&
    !pendingAssistantAlreadyPersisted &&
    (!pendingUserAlreadyPersisted || Boolean(streamingReply));
  const isReplyPending = shouldShowPendingUserMessage || shouldShowPendingAssistantMessage;
  const displayMessages =
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
                },
              ]
            : []),
        ]
      : messages;
  const hasStartedConversation = displayMessages.length > 0;
  const selectedModel = useMemo(
    () =>
      enabledModels.find((option) => option.alias === selectedModelId) ||
      enabledModels[0] ||
      null,
    [enabledModels, selectedModelId],
  );
  const currentViewMode = activeConversation?.viewState?.mode || viewMode;

  const isAnySettingsPanelOpen = useMemo(
    () =>
      isModelPanelOpen || isAppearancePanelOpen || isInteractionPanelOpen || isSettingsMenuOpen,
    [isModelPanelOpen, isAppearancePanelOpen, isInteractionPanelOpen, isSettingsMenuOpen],
  );

  const shouldHideComposer = useMemo(
    () => currentViewMode !== "chat" || isAnySettingsPanelOpen || isSidebarDrawerOpen,
    [currentViewMode, isAnySettingsPanelOpen, isSidebarDrawerOpen],
  );

  useEffect(() => {
    if (shouldHideComposer) {
      setIsComposerCollapsed(true);
    } else {
      setIsComposerCollapsed(false);
    }
  }, [shouldHideComposer]);

  const focusedBlockSHA1 = useMemo(
    () =>
      focusedBlockSHA1State || resolveFocusedBlockSHA1(activeSessionDetail, graph.activeBlockSHA1),
    [focusedBlockSHA1State, activeSessionDetail, graph.activeBlockSHA1],
  );

  const blocks = graph.blocks ?? [];
  const activeBlockSHA1 = graph.activeBlockSHA1 ?? "";

  const issueChatNavigationRequest = (reason, behavior = "auto", targetBlockSHA1 = "") => {
    chatNavigationRequestIdRef.current += 1;
    setChatNavigationRequest({
      id: chatNavigationRequestIdRef.current,
      reason,
      behavior,
      targetBlockSHA1,
    });
  };

  const handleChatNavigationRequestHandled = (requestId) => {
    setChatNavigationRequest((currentRequest) =>
      currentRequest?.id === requestId ? null : currentRequest,
    );
  };

  const applySessionDetail = (detail, options = {}) => {
    const nextSessionHash = detail?.session?.sessionHash ?? "";
    const nextFocusedBlockSHA1 = resolveFocusedBlockSHA1(detail, "");
    const isSameSession =
      activeSessionHashRef.current && activeSessionHashRef.current === nextSessionHash;

    setActiveSessionDetail(detail);
    setFocusedBlockSHA1State((currentFocusedBlockSHA1) =>
      isSameSession && currentFocusedBlockSHA1
        ? currentFocusedBlockSHA1
        : nextFocusedBlockSHA1,
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
  };

  const handleFocusBlock = async (blockSHA1) => {
    if (!activeConversation?.sessionHash || !blockSHA1 || isLoading) {
      return;
    }

    if (blockSHA1 === focusedBlockSHA1) {
      return;
    }

    setError("");
    setFocusedBlockSHA1State(blockSHA1);

    try {
      await setFocusedBlock(activeConversation.sessionHash, blockSHA1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "更新焦点失败，请稍后再试。",
      );
    }
  };

  const handleSelectBlock = (sha1) => {
    if (!sha1 || sha1 === focusedBlockSHA1) return;
    issueChatNavigationRequest("block-selector", "smooth", sha1);
  };

  const applyModels = (models, preferredAlias = selectedModelId) => {
    setModelOptions(models);
    setSelectedModelId(pickEnabledModelAlias(models, preferredAlias));
  };

  const handleNewChat = async () => {
    if (isLoading) {
      return;
    }

    setError("");

    try {
      const detail = await createSession();
      applySessionDetail(detail);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "创建会话失败，请稍后再试。",
      );
    }
  };

  const handleSelectConversation = async (conversationId) => {
    if (isLoading) {
      return;
    }

    setError("");

    try {
      const detail = await getSession(conversationId);
      applySessionDetail(detail, {
        reason: "select-session",
        behavior: "auto",
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "读取会话失败，请稍后再试。",
      );
    }
  };

  const handleDeleteConversation = async (conversation) => {
    if (!conversation?.id || isLoading) {
      return;
    }

    const confirmed = window.confirm(
      `确认删除会话《${conversation.title || "未命名会话"}》吗？\n\n这会同时删除该会话下的 block、摘要、错误日志和适配记录，且无法撤销。`,
    );

    if (!confirmed) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const result = await deleteSession(conversation.id);
      const remainingSessions = result.sessions ?? [];
      setSessionSummaries(remainingSessions);

      if (activeConversation?.sessionHash === conversation.id) {
        if (remainingSessions.length > 0) {
          const detail = await getSession(remainingSessions[0].sessionHash);
          applySessionDetail(detail, {
            reason: "delete-fallback-session",
            behavior: "auto",
          });
        } else {
          setActiveSessionDetail(null);
          setViewMode("chat");
        }
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "删除会话失败，请稍后再试。",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenameConversation = async (conversation, nextTitle) => {
    if (!conversation?.id || isLoading) {
      return;
    }

    const trimmedTitle = `${nextTitle ?? ""}`.trim();

    if (!trimmedTitle || trimmedTitle === conversation.title) {
      return;
    }

    setError("");

    try {
      const detail = await updateSessionTitle(conversation.id, trimmedTitle);

      if (activeConversation?.sessionHash === conversation.id) {
        applySessionDetail(detail);
        return;
      }

      setSessionSummaries((currentSessions) =>
        upsertSessionSummary(currentSessions, detail.session),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "更新会话名称失败，请稍后再试。",
      );
      throw requestError;
    }
  };

  const handleChangeViewMode = async (nextMode) => {
    if (!nextMode || nextMode === currentViewMode) {
      return;
    }

    const previousMode = currentViewMode;
    setViewMode(nextMode);
    setError("");

    if (!activeConversation?.sessionHash) {
      return;
    }

    try {
      const detail = await updateSessionViewState(activeConversation.sessionHash, nextMode);
      applySessionDetail(detail, {
        reason: "switch-to-chat",
        behavior: "auto",
      });
    } catch (requestError) {
      setViewMode(previousMode);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "切换视图失败，请稍后再试。",
      );
    }
  };

  const handleActivateBlock = async (blockSHA1) => {
    if (!activeConversation?.sessionHash || isLoading) {
      return;
    }

    setError("");
    setFocusedBlockSHA1State(blockSHA1);

    try {
      await setFocusedBlock(activeConversation.sessionHash, blockSHA1);

      const detail = await setActiveBlock(activeConversation.sessionHash, blockSHA1);
      applySessionDetail(detail, {
        reason: "activate-block",
        behavior: "auto",
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "切换分支失败，请稍后再试。",
      );
    }
  };

  const handleBranchFromBlock = async (blockSHA1) => {
    if (!activeConversation?.sessionHash || isLoading) {
      return;
    }

    setError("");

    try {
      const detail = await branchFromBlock({
        sessionHash: activeConversation.sessionHash,
        blockSHA1,
      });
      applySessionDetail(detail, {
        reason: "branch-from-block",
        behavior: "auto",
      });

      await setFocusedBlock(activeConversation.sessionHash, blockSHA1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "创建分支失败，请稍后再试。",
      );
    }
  };

  const handleRegenerate = async (blockSHA1) => {
    if (!activeConversation?.sessionHash || !selectedModel || isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const detail = await regenerateBlock({
        sessionHash: activeConversation.sessionHash,
        blockSHA1,
        modelAlias: selectedModel.alias,
      });
      applySessionDetail(detail, {
        reason: "regenerate-block",
        behavior: "auto",
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "重新生成失败，请稍后再试。",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleAdaptation = async (blockSHA1, key, enabled) => {
    if (!activeConversation?.sessionHash || isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const result = await updateBlockAdaptation({
        sessionHash: activeConversation.sessionHash,
        blockSHA1,
        key,
        enabled,
      });
      applySessionDetail(result.detail);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "更新适配项失败，请稍后再试。",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunAdaptation = async (blockSHA1, key) => {
    if (!activeConversation?.sessionHash || isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const result = await runBlockAdaptationCommand({
        sessionHash: activeConversation.sessionHash,
        blockSHA1,
        key,
        modelAlias: selectedModel?.alias,
      });
      applySessionDetail(result.detail);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "执行适配命令失败，请稍后再试。",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateModel = async (payload) => {
    setIsModelSaving(true);
    setError("");

    try {
      const result = await createModelConfig(payload);
      applyModels(result.models, result.model?.alias || payload.alias);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "创建模型失败，请稍后再试。",
      );
      throw requestError;
    } finally {
      setIsModelSaving(false);
    }
  };

  const handleUpdateModel = async (alias, payload) => {
    setIsModelSaving(true);
    setError("");

    try {
      const result = await updateModelConfig(alias, payload);
      applyModels(result.models, result.model?.alias || alias);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "更新模型失败，请稍后再试。",
      );
      throw requestError;
    } finally {
      setIsModelSaving(false);
    }
  };

  const handleDeleteModel = async (alias) => {
    setIsModelSaving(true);
    setError("");

    try {
      const result = await deleteModelConfig(alias);
      applyModels(result.models, selectedModelId === alias ? "" : selectedModelId);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "删除模型失败，请稍后再试。",
      );
      throw requestError;
    } finally {
      setIsModelSaving(false);
    }
  };

  const handleToggleShowChatFocusOutline = async (enabled) => {
    setIsAppearanceSaving(true);
    setError("");

    try {
      const result = await updateAppSettings({
        showChatFocusOutline: enabled,
      });
      setAppSettings(result?.settings ?? {});
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "更新外观设置失败，请稍后再试。",
      );
    } finally {
      setIsAppearanceSaving(false);
    }
  };

  const handleToggleHideWideScreenSideBranches = async (enabled) => {
    setIsAppearanceSaving(true);
    setError("");

    try {
      const result = await updateAppSettings({
        hideWideScreenSideBranches: enabled,
      });
      setAppSettings(result?.settings ?? {});
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "更新外观设置失败，请稍后再试。",
      );
    } finally {
      setIsAppearanceSaving(false);
    }
  };

  const handleToggleDarkMode = async (mode) => {
    setIsAppearanceSaving(true);
    setError("");

    try {
      const result = await updateAppSettings({
        darkMode: mode,
      });
      setAppSettings(result?.settings ?? {});
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "更新外观设置失败，请稍后再试。",
      );
    } finally {
      setIsAppearanceSaving(false);
    }
  };

  const updateInteractionSettings = async (partialSettings) => {
    setIsInteractionSaving(true);
    setError("");

    try {
      const result = await updateAppSettings(partialSettings);
      setAppSettings(result?.settings ?? {});
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "更新交互设置失败，请稍后再试。",
      );
    } finally {
      setIsInteractionSaving(false);
    }
  };

  const handleToggleShowChatAdaptationButtons = async (enabled) => {
    await updateInteractionSettings({
      showChatAdaptationButtons: enabled,
    });
  };

  const handleToggleSingleChatAdaptationButton = async (settingKey, enabled) => {
    if (!settingKey) {
      return;
    }

    await updateInteractionSettings({
      [settingKey]: enabled,
    });
  };

  function scheduleStreamingFlush() {
    if (streamFlushRafRef.current) {
      return;
    }
    streamFlushRafRef.current = requestAnimationFrame(() => {
      streamFlushRafRef.current = 0;
      setStreamingReply(streamBufferRef.current);
    });
  }

  async function handleSend(rawText) {
    const text = rawText.trim();

    if (!text || isLoading || !selectedModel) {
      return;
    }

    setIsLoading(true);
    setPendingPrompt(text);
    setStreamingReply("");
    setError("");

    let sessionHash = activeConversation?.sessionHash || "";
    const supportsStreaming = selectedModel.supportsStreaming !== false;

    try {
      if (!sessionHash) {
        const createdDetail = await createSession();
        applySessionDetail(createdDetail);
        sessionHash = createdDetail.session.sessionHash;
      }

      if (!supportsStreaming) {
        const detail = await sendReply({
          sessionHash,
          prompt: text,
          modelAlias: selectedModel.alias,
        });

        applySessionDetail(detail, {
          revealLatestInChat: true,
          reason: "send-reply",
          behavior: "auto",
        });

        return;
      }

      const abortController = new AbortController();
      streamAbortControllerRef.current = abortController;

      let streamedDetail = null;

      await sendReplyStream({
        sessionHash,
        prompt: text,
        modelAlias: selectedModel.alias,
        signal: abortController.signal,
        onEvent: async (event) => {
          if (event?.type === "delta") {
            streamBufferRef.current += event.delta || "";
            scheduleStreamingFlush();
            return;
          }

          if (event?.type === "complete") {
            streamedDetail = event.detail;
            return;
          }

          if (event?.type === "error") {
            throw new Error(event.error || "请求失败了，请稍后再试。");
          }
        },
      });

      if (!streamedDetail) {
        throw new Error("流式请求未返回完成事件。");
      }

      const detail = streamedDetail;

      applySessionDetail(detail, {
        revealLatestInChat: true,
        reason: "send-reply",
        behavior: "auto",
      });
    } catch (requestError) {
      if (requestError?.name === "AbortError") {
        setError("已停止生成。");
      } else {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "请求失败了，请稍后再试。",
      );
      }
    } finally {
      if (streamFlushRafRef.current) {
        cancelAnimationFrame(streamFlushRafRef.current);
        streamFlushRafRef.current = 0;
      }
      streamBufferRef.current = "";
      setIsLoading(false);
      setPendingPrompt("");
      setStreamingReply("");
      streamAbortControllerRef.current = null;
    }
  }

  const handleStopStreaming = () => {
    streamAbortControllerRef.current?.abort();
  };

  const handleToggleSidebarMenu = () => {
    if (layoutMode === "desktop") {
      setIsSidebarCollapsed((current) => !current);
      return;
    }

    setIsSidebarDrawerOpen((current) => !current);
  };

  const handleDrawerTouchStart = (event) => {
    if (!isSidebarDrawerOpen || layoutMode === "desktop") {
      return;
    }

    const touch = event.touches[0];

    drawerTouchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      active: true,
    };
    drawerSwipeDetectedRef.current = false;
  };

  const handleDrawerTouchMove = (event) => {
    if (!drawerTouchStartRef.current.active || drawerSwipeDetectedRef.current) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - drawerTouchStartRef.current.x;
    const deltaY = touch.clientY - drawerTouchStartRef.current.y;

    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }

    if (deltaX <= -56) {
      drawerSwipeDetectedRef.current = true;
      drawerTouchStartRef.current.active = false;
      setIsSidebarDrawerOpen(false);
    }
  };

  const handleDrawerTouchEnd = () => {
    drawerTouchStartRef.current.active = false;
    drawerSwipeDetectedRef.current = false;
  };

  const handleNewChatFromSidebar = () => {
    if (layoutMode !== "desktop") {
      setIsSidebarDrawerOpen(false);
    }

    handleNewChat();
  };

  const handleSelectConversationFromSidebar = (sessionHash) => {
    if (layoutMode !== "desktop") {
      setIsSidebarDrawerOpen(false);
    }

    handleSelectConversation(sessionHash);
  };

  const sidebarConversations = useMemo(
    () =>
      sessionSummaries.map((session) => ({
        id: session.sessionHash,
        title: session.title,
      })),
    [sessionSummaries],
  );

  const handleSelectSettingsSection = (sectionKey) => {
    setIsSettingsMenuOpen(false);

    if (sectionKey === "model") {
      setIsModelPanelOpen(true);
      return;
    }

    if (sectionKey === "appearance") {
      setIsAppearancePanelOpen(true);
      return;
    }

    if (sectionKey === "behavior") {
      setIsInteractionPanelOpen(true);
    }
  };

  function renderWorkspace() {
    if (isBootstrapping) {
      return (
        <div className="empty-state">
          <h2 className="hero-title">正在加载会话...</h2>
        </div>
      );
    }

    if (!activeConversation) {
      return <ChatHero />;
    }

    if (currentViewMode === "chat") {
      if (!hasStartedConversation) {
        return <ChatHero />;
      }

      return (
        <ChatView
          graphBlocks={graph.blocks}
          activeBlockSHA1={graph.activeBlockSHA1}
          focusedBlockSHA1={focusedBlockSHA1}
          isReplyPending={isReplyPending}
          bottomDockMode={bottomDockMode}
          hideWideScreenSideBranches={hideWideScreenSideBranches}
          messages={displayMessages}
          navigationRequest={chatNavigationRequest}
          isLoading={isLoading}
          adaptationDefinitions={adaptationDefinitions}
          adaptationButtonVisibility={chatAdaptationButtonVisibility}
          onActivateBlock={handleActivateBlock}
          onFocusBlock={handleFocusBlock}
          onBranchFromBlock={handleBranchFromBlock}
          onRegenerate={handleRegenerate}
          onToggleAdaptation={handleToggleAdaptation}
          onRunAdaptation={handleRunAdaptation}
          onScrollRequestHandled={handleChatNavigationRequestHandled}
        />
      );
    }

    if (currentViewMode === "chain") {
      return (
        <ChainCardView
          blocks={activeChainBlocks}
          isLoading={isLoading}
          adaptationDefinitions={adaptationDefinitions}
          onActivateBlock={handleActivateBlock}
          onFocusBlock={handleFocusBlock}
          focusedBlockSHA1={focusedBlockSHA1}
          onBranchFromBlock={handleBranchFromBlock}
          onRegenerate={handleRegenerate}
          onToggleAdaptation={handleToggleAdaptation}
          onRunAdaptation={handleRunAdaptation}
        />
      );
    }

    return (
      <GraphView
        blocks={graph.blocks}
        graph={graph}
        focusedBlockSHA1={focusedBlockSHA1}
        isLoading={isLoading}
        adaptationDefinitions={adaptationDefinitions}
        onActivateBlock={handleActivateBlock}
        onFocusBlock={handleFocusBlock}
        onBranchFromBlock={handleBranchFromBlock}
        onRegenerate={handleRegenerate}
        onToggleAdaptation={handleToggleAdaptation}
        onRunAdaptation={handleRunAdaptation}
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app-shell login-shell">
        <LoginView onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div
      className={`app-shell layout-${layoutMode} ${showChatFocusOutline ? "" : "hide-chat-focus-outline"}`.trim()}
    >
      {layoutMode !== "mobile" ? (
        <Sidebar
          conversations={sidebarConversations}
          activeConversationId={activeConversation?.sessionHash}
          onNewChat={handleNewChatFromSidebar}
          onSelectConversation={handleSelectConversationFromSidebar}
          onDeleteConversation={handleDeleteConversation}
          onRenameConversation={handleRenameConversation}
          isCollapsed={layoutMode === "tablet" ? true : isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebarMenu}
          onOpenSettings={() => setIsSettingsMenuOpen(true)}
          className={layoutMode === "tablet" ? "sidebar-rail" : ""}
          showHeaderToggle={layoutMode === "desktop"}
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      ) : null}

      {showSidebarMenuButton ? (
        <>
          <div
            className={`sidebar-drawer-backdrop ${isSidebarDrawerOpen ? "open" : ""}`.trim()}
            onClick={() => setIsSidebarDrawerOpen(false)}
            aria-hidden={isSidebarDrawerOpen ? "false" : "true"}
          />
          <Sidebar
            conversations={sidebarConversations}
            activeConversationId={activeConversation?.sessionHash}
            onNewChat={handleNewChatFromSidebar}
            onSelectConversation={handleSelectConversationFromSidebar}
            onDeleteConversation={handleDeleteConversation}
            onRenameConversation={handleRenameConversation}
            isCollapsed={false}
            onToggleCollapse={() => setIsSidebarDrawerOpen(false)}
            onOpenSettings={() => {
              setIsSidebarDrawerOpen(false);
              setIsSettingsMenuOpen(true);
            }}
            className={`sidebar-drawer ${isSidebarDrawerOpen ? "open" : ""}`.trim()}
            toggleVariant="close"
            onTouchStart={handleDrawerTouchStart}
            onTouchMove={handleDrawerTouchMove}
            onTouchEnd={handleDrawerTouchEnd}
            currentUser={currentUser}
            onLogout={handleLogout}
          />
        </>
      ) : null}

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-title-group">
            <div className="topbar-title">{activeConversation?.title || "新对话"}</div>
            <div className="topbar-subtitle">
              {graph.blocks.length > 0
                ? `${graph.blocks.length} 个块 · 当前链 ${Math.max(activeChainBlocks.length - 1, 0)} 轮对话`
                : "多视图对话工作台"}
            </div>
          </div>
          <div className="topbar-actions">
            {showSidebarMenuButton ? (
              <button
                className="topbar-menu-btn"
                type="button"
                onClick={() => setIsSidebarDrawerOpen(true)}
                aria-label="打开会话列表"
                title="打开会话列表"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            ) : null}
            <ViewModeSwitcher value={currentViewMode} onChange={handleChangeViewMode} />
          </div>
        </header>

        <div className="main-panel-content">
          {renderWorkspace()}

          {enabledModels.length === 0 ? (
            <p className="inline-warning">
              当前没有启用模型，请先在"模型设置"里新增或启用一个模型。          </p>
          ) : null}

          {error ? <p className="inline-error">{error}</p> : null}
        </div>

        {!(isSidebarDrawerOpen && layoutMode === "mobile") && (
        <div className="main-panel-composer">
        <ChatComposer
          isLoading={isLoading || isBootstrapping || !selectedModel}
          canStop={Boolean(streamAbortControllerRef.current && isLoading)}
          modelOptions={enabledModels}
          selectedModelId={selectedModelId}
          isCollapsed={isComposerCollapsed}
          onToggleCollapsed={() => setIsComposerCollapsed((current) => !current)}
          onChangeModel={setSelectedModelId}
          onSend={handleSend}
          onStop={handleStopStreaming}
          hideToolbar={shouldHideComposer}
          blocks={blocks}
          focusedBlockSHA1={focusedBlockSHA1}
          activeBlockSHA1={activeBlockSHA1}
          onSelectBlock={handleSelectBlock}
        />
        </div>
        )}
      </main>

      <ModelSettingsPanel
        open={isModelPanelOpen}
        models={modelOptions}
        providerDefinitions={providerDefinitions}
        isSaving={isModelSaving}
        isAdmin={isAdmin}
        onClose={() => setIsModelPanelOpen(false)}
        onCreateModel={handleCreateModel}
        onUpdateModel={handleUpdateModel}
        onDeleteModel={handleDeleteModel}
      />

      <AppearanceSettingsPanel
        open={isAppearancePanelOpen}
        settings={appSettings}
        isSaving={isAppearanceSaving}
        onClose={() => setIsAppearancePanelOpen(false)}
        onToggleShowChatFocusOutline={handleToggleShowChatFocusOutline}
        onToggleHideWideScreenSideBranches={handleToggleHideWideScreenSideBranches}
        onToggleDarkMode={handleToggleDarkMode}
      />

      <InteractionSettingsPanel
        open={isInteractionPanelOpen}
        settings={appSettings}
        isSaving={isInteractionSaving}
        onClose={() => setIsInteractionPanelOpen(false)}
        onToggleShowChatAdaptationButtons={handleToggleShowChatAdaptationButtons}
        onToggleSingleChatAdaptationButton={handleToggleSingleChatAdaptationButton}
      />

      <SettingsMenuPanel
        open={isSettingsMenuOpen}
        onClose={() => setIsSettingsMenuOpen(false)}
        onSelectSection={handleSelectSettingsSection}
      />
    </div>
  );
}
