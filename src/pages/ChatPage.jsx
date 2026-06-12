import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../contexts/SessionContext";
import { useApp } from "../contexts/AppContext";
import { useLocale } from "../contexts/LocaleContext";
import ChatHero from "../components/ChatHero";
import ChatView from "../components/ChatView";
import ChainCardView from "../components/ChainCardView";
import GraphView from "../components/GraphView";

export default function ChatPage() {
  const { t } = useLocale();
  const { sessionHash } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const session = useSession();
  const { appSettings, enabledModels, adaptationDefinitions } = useApp();

  const urlView = searchParams.get("view") || "chat";
  const loadingSessionHashRef = useRef("");
  const redirectTimerRef = useRef(0);
  const sessionMethodsRef = useRef(null);
  const sessionSummariesRef = useRef(session.sessionSummaries);
  sessionSummariesRef.current = session.sessionSummaries;
  sessionMethodsRef.current = {
    selectConversation: session.selectConversation,
    subscribeToStream: session.subscribeToStream,
    setError: session.setError,
    changeViewMode: session.changeViewMode,
  };

  useEffect(() => {
    if (!sessionHash) return;
    if (session.activeConversation?.sessionHash === sessionHash) {
      loadingSessionHashRef.current = "";
      return;
    }
    if (loadingSessionHashRef.current === sessionHash) return;

    loadingSessionHashRef.current = sessionHash;
    const methods = sessionMethodsRef.current;
    let cancelled = false;

    async function load() {
      try {
        const detail = await methods.selectConversation(sessionHash);
        if (!cancelled && detail) {
          methods.subscribeToStream(sessionHash);
        }
        if (!cancelled && !detail && !cancelled) {
          methods.setError(t("chat.sessionMissing"));
          redirectTimerRef.current = window.setTimeout(() => {
            const summaries = sessionSummariesRef.current;
            if (summaries.length > 0) {
              navigate(`/chat/${summaries[0].sessionHash}`, { replace: true });
            } else {
              navigate("/", { replace: true });
            }
          }, 2000);
        }
      } catch {
        if (!cancelled) {
          methods.setError(t("chat.sessionMissing"));
          redirectTimerRef.current = window.setTimeout(() => {
            const summaries = sessionSummariesRef.current;
            if (summaries.length > 0) {
              navigate(`/chat/${summaries[0].sessionHash}`, { replace: true });
            } else {
              navigate("/", { replace: true });
            }
          }, 2000);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      loadingSessionHashRef.current = "";
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = 0;
      }
    };
  }, [sessionHash, session.activeConversation?.sessionHash, t]);

  useEffect(() => {
    const methods = sessionMethodsRef.current;
    if (methods.changeViewMode && urlView !== session.currentViewMode) {
      methods.changeViewMode(urlView);
    }
  }, [urlView]);

  const chatAdaptationButtonVisibility = useMemo(
    () => ({
      enabled: appSettings.showChatAdaptationButtons !== false,
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
      appSettings.showChatAdaptationButtons,
    ],
  );

  if (session.isBootstrapping) {
    return (
      <div className="empty-state">
        <h2 className="hero-title">{t("chat.loadingSession")}</h2>
      </div>
    );
  }

  if (sessionHash && session.activeConversation?.sessionHash !== sessionHash) {
    return (
      <div className="empty-state">
        <h2 className="hero-title">{t("chat.loadingSession")}</h2>
      </div>
    );
  }

  if (!session.activeConversation) {
    return (
      <ChatHero
        hasModels={enabledModels.length > 0}
        onOpenSettings={() =>
          window.dispatchEvent(
            new CustomEvent("open-settings", { detail: { section: "model" } }),
          )
        }
      />
    );
  }

  const effectiveView = urlView || session.currentViewMode;

  // Show ChatHero when conversation hasn't started yet
  if (effectiveView === "chat" && !session.hasStartedConversation) {
    return (
      <ChatHero
        hasModels={enabledModels.length > 0}
        onOpenSettings={() =>
          window.dispatchEvent(
            new CustomEvent("open-settings", { detail: { section: "model" } }),
          )
        }
      />
    );
  }

  // All views are always mounted, use CSS to show/hide for instant switching
  return (
    <div className="chat-page-views" style={{ display: 'contents' }}>
      {/* Chat View */}
      <div
        style={{ display: effectiveView === 'chat' ? 'contents' : 'none' }}
        aria-hidden={effectiveView !== 'chat'}
      >
        <ChatView
          graphBlocks={session.graph.blocks}
          activeBlockSHA1={session.graph.activeBlockSHA1}
          focusedBlockSHA1={session.focusedBlockSHA1}
          isReplyPending={session.isReplyPending}
          bottomDockMode={appSettings.bottomDockMode || "smart"}
          hideWideScreenSideBranches={
            appSettings.hideWideScreenSideBranches === true
          }
          messages={session.displayMessages}
          navigationRequest={session.chatNavigationRequest}
          isLoading={session.isLoading}
          streamingToolState={session.streamingToolState}
          hideChatBottomDock={false}
          adaptationDefinitions={adaptationDefinitions}
          adaptationButtonVisibility={chatAdaptationButtonVisibility}
          onActivateBlock={session.activateBlock}
          onFocusBlock={session.focusBlock}
          onBranchFromBlock={session.branchFromBlock}
          onRegenerate={session.regenerate}
          onToggleAdaptation={session.toggleAdaptation}
          onRunAdaptation={session.runAdaptation}
          onScrollRequestHandled={session.handleChatNavigationRequestHandled}
        />
      </div>

      {/* Chain View */}
      <div
        style={{ display: effectiveView === 'chain' ? 'contents' : 'none' }}
        aria-hidden={effectiveView !== 'chain'}
      >
        <ChainCardView
          blocks={session.activeChainBlocks}
          isLoading={session.isLoading}
          adaptationDefinitions={adaptationDefinitions}
          onActivateBlock={session.activateBlock}
          onFocusBlock={session.focusBlock}
          focusedBlockSHA1={session.focusedBlockSHA1}
          onBranchFromBlock={session.branchFromBlock}
          onRegenerate={session.regenerate}
          onToggleAdaptation={session.toggleAdaptation}
          onRunAdaptation={session.runAdaptation}
        />
      </div>

      {/* Graph View */}
      <div
        style={{ display: effectiveView === 'graph' ? 'contents' : 'none' }}
        aria-hidden={effectiveView !== 'graph'}
      >
        <GraphView
          blocks={session.graph.blocks}
          graph={session.graph}
          focusedBlockSHA1={session.focusedBlockSHA1}
          isLoading={session.isLoading}
          adaptationDefinitions={adaptationDefinitions}
          onActivateBlock={session.activateBlock}
          onFocusBlock={session.focusBlock}
          onBranchFromBlock={session.branchFromBlock}
          onRegenerate={session.regenerate}
          onToggleAdaptation={session.toggleAdaptation}
          onRunAdaptation={session.runAdaptation}
        />
      </div>
    </div>
  );
}
