import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Outlet,
} from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useApp } from "../contexts/AppContext";
import { useSession } from "../contexts/SessionContext";
import { useLocale } from "../contexts/LocaleContext";
import Sidebar from "../components/Sidebar";
import ViewModeSwitcher from "../components/ViewModeSwitcher";
import ChatComposer from "../components/ChatComposer";
import ModelSettingsPanel from "../components/ModelSettingsPanel";
import AppearanceSettingsPanel from "../components/AppearanceSettingsPanel";
import InteractionSettingsPanel from "../components/InteractionSettingsPanel";
import AboutSettingsPanel from "../components/AboutSettingsPanel";
import SettingsMenuPanel from "../components/SettingsMenuPanel";

function resolveLayoutMode(viewportWidth) {
  if (viewportWidth < 600) return "mobile";
  if (viewportWidth <= 1280) return "tablet";
  return "desktop";
}

const SIDEBAR_COLLAPSED_KEY = "hi-web-talk:isSidebarCollapsed";

function getStoredSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export default function AuthenticatedLayout() {
  const { isAdmin: isAdminUser } = useAuth();
  const { t } = useLocale();
  const {
    modelOptions,
    enabledModels,
    providers,
    providerDefinitions,
    appSettings,
    selectedModelId,
    setSelectedModelId,
    isModelSaving,
    isAppearanceSaving,
    isInteractionSaving,
    createModel,
    updateModel,
    deleteModel,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleDarkMode,
    toggleShowChatFocusOutline,
    toggleHideWideScreenSideBranches,
    toggleShowChatAdaptationButtons,
    toggleSingleChatAdaptationButton,
    changeTitleModel,
    changeSummaryModel,
    error: appError,
    toast,
  } = useApp();
  const {
    activeConversation,
    graph,
    activeChainBlocks,
    blocks,
    focusedBlockSHA1,
    activeBlockSHA1,
    currentViewMode,
    isLoading: sessionLoading,
    isBootstrapping: sessionBootstrapping,
    error: sessionError,
    selectBlock,
    send,
    stopStreaming,
    uploadAttachment,
    abortControllerRef,
  } = useSession();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    getStoredSidebarCollapsed(),
  );
  const [isSidebarDrawerOpen, setIsSidebarDrawerOpen] = useState(false);
  const [isComposerCollapsed, setIsComposerCollapsed] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [isModelPanelOpen, setIsModelPanelOpen] = useState(false);
  const [isAppearancePanelOpen, setIsAppearancePanelOpen] = useState(false);
  const [isInteractionPanelOpen, setIsInteractionPanelOpen] = useState(false);
  const [isAboutPanelOpen, setIsAboutPanelOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);

  const drawerTouchStartRef = useRef({ x: 0, y: 0, active: false });
  const drawerSwipeDetectedRef = useRef(false);

  const layoutMode = resolveLayoutMode(viewportWidth);
  const showSidebarMenuButton = layoutMode === "mobile";
  const isAdmin = isAdminUser;

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (layoutMode === "desktop") {
      setIsSidebarDrawerOpen(false);
    }
  }, [layoutMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_COLLAPSED_KEY,
        isSidebarCollapsed ? "true" : "false",
      );
    } catch {
      // ignore
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    function handleOpenSettings(event) {
      const section = event?.detail?.section;
      if (!section) return;
      setIsSettingsMenuOpen(false);
      if (section === "model") {
        setIsModelPanelOpen(true);
      } else if (section === "appearance") {
        setIsAppearancePanelOpen(true);
      } else if (section === "behavior") {
        setIsInteractionPanelOpen(true);
      } else if (section === "about") {
        setIsAboutPanelOpen(true);
      }
    }
    window.addEventListener("open-settings", handleOpenSettings);
    return () => window.removeEventListener("open-settings", handleOpenSettings);
  }, []);

  const isAnySettingsPanelOpen = useMemo(
    () =>
      isModelPanelOpen ||
      isAppearancePanelOpen ||
      isInteractionPanelOpen ||
      isAboutPanelOpen ||
      isSettingsMenuOpen,
    [
      isModelPanelOpen,
      isAppearancePanelOpen,
      isInteractionPanelOpen,
      isAboutPanelOpen,
      isSettingsMenuOpen,
    ],
  );

  const shouldHideComposer = useMemo(
    () =>
      currentViewMode !== "chat" ||
      isAnySettingsPanelOpen ||
      isSidebarDrawerOpen,
    [currentViewMode, isAnySettingsPanelOpen, isSidebarDrawerOpen],
  );

  useEffect(() => {
    if (shouldHideComposer) {
      setIsComposerCollapsed(true);
    } else {
      setIsComposerCollapsed(false);
    }
  }, [shouldHideComposer]);

  const handleSelectSettingsSection = useCallback((sectionKey) => {
    setIsSettingsMenuOpen(false);
    if (sectionKey === "model") {
      setIsModelPanelOpen(true);
    } else if (sectionKey === "appearance") {
      setIsAppearancePanelOpen(true);
    } else if (sectionKey === "behavior") {
      setIsInteractionPanelOpen(true);
    } else if (sectionKey === "about") {
      setIsAboutPanelOpen(true);
    }
  }, []);

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

  const isLoading =
    sessionLoading ||
    sessionBootstrapping ||
    !enabledModels.length;

  const canStop = Boolean(
    abortControllerRef?.current && sessionLoading,
  );

  const displayError = sessionError || appError;

  return (
    <div
      className={`app-shell layout-${layoutMode} ${appSettings.showChatFocusOutline !== false ? "" : "hide-chat-focus-outline"}`.trim()}
    >
      {layoutMode !== "mobile" ? (
        <Sidebar
          isCollapsed={
            layoutMode === "tablet" ? true : isSidebarCollapsed
          }
          onToggleCollapse={handleToggleSidebarMenu}
          onOpenSettings={() => setIsSettingsMenuOpen(true)}
          className={layoutMode === "tablet" ? "sidebar-rail" : ""}
          showHeaderToggle={layoutMode !== "mobile"}
        />
      ) : null}

      {layoutMode !== "desktop" ? (
        <>
          <div
            className={`sidebar-drawer-backdrop ${isSidebarDrawerOpen ? "open" : ""}`.trim()}
            onClick={() => setIsSidebarDrawerOpen(false)}
            aria-hidden={isSidebarDrawerOpen ? "false" : "true"}
          />
          <Sidebar
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
          />
        </>
      ) : null}

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-title-group">
            <div className="topbar-title">
              {activeConversation?.title || t("app.newConversation")}
            </div>
            <div className="topbar-subtitle">
              {(graph.blocks?.length ?? 0) > 0
                ? t("app.sessionSubtitle", {
                    blockCount: graph.blocks.length,
                    roundCount: Math.max(activeChainBlocks.length - 1, 0),
                  })
                : t("app.multiViewWorkbench")}
            </div>
          </div>
          <div className="topbar-actions">
            {showSidebarMenuButton ? (
              <button
                className="topbar-menu-btn"
                type="button"
                onClick={() => setIsSidebarDrawerOpen(true)}
                aria-label={t("app.openSidebar")}
                title={t("app.openSidebar")}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 7h16M4 12h16M4 17h16"
                  />
                </svg>
              </button>
            ) : null}
            <ViewModeSwitcher />
          </div>
        </header>

        <div className="main-panel-content">
          <Outlet />

          {displayError && (
            <div className="global-toast-container">
              <div className="toast-message error">
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{displayError}</span>
              </div>
            </div>
          )}

          {toast.message && (
            <div className="global-toast-container">
              <div className={`toast-message ${toast.type}`}>
                <span>{toast.message}</span>
              </div>
            </div>
          )}
        </div>

        <div className={`main-panel-composer ${shouldHideComposer ? 'hidden' : ''}`}>
          <ChatComposer
            isLoading={isLoading || !enabledModels.length}
            canStop={canStop}
            modelOptions={enabledModels}
            providers={providers}
            selectedModelId={selectedModelId}
            isCollapsed={isComposerCollapsed}
            onToggleCollapsed={() =>
              setIsComposerCollapsed((current) => !current)
            }
            onChangeModel={setSelectedModelId}
            onSend={send}
            onUploadAttachment={uploadAttachment}
            onStop={stopStreaming}
            hideToolbar={shouldHideComposer}
            blocks={blocks}
            focusedBlockSHA1={focusedBlockSHA1}
            activeBlockSHA1={activeBlockSHA1}
            onSelectBlock={selectBlock}
            sessionHash={activeConversation?.sessionHash}
          />
        </div>
      </main>

      <ModelSettingsPanel
        open={isModelPanelOpen}
        models={modelOptions}
        providers={providers}
        providerDefinitions={providerDefinitions}
        isSaving={isModelSaving}
        isAdmin={isAdmin}
        onClose={() => {
          setIsModelPanelOpen(false);
          setIsSettingsMenuOpen(true);
        }}
        onCreateModel={createModel}
        onUpdateModel={updateModel}
        onDeleteModel={deleteModel}
        onCreateProvider={createProvider}
        onUpdateProvider={updateProvider}
        onDeleteProvider={deleteProvider}
      />

      <AppearanceSettingsPanel
        open={isAppearancePanelOpen}
        settings={appSettings}
        isSaving={isAppearanceSaving}
        onClose={() => {
          setIsAppearancePanelOpen(false);
          setIsSettingsMenuOpen(true);
        }}
        onToggleShowChatFocusOutline={toggleShowChatFocusOutline}
        onToggleHideWideScreenSideBranches={
          toggleHideWideScreenSideBranches
        }
        onToggleDarkMode={toggleDarkMode}
      />

      <InteractionSettingsPanel
        open={isInteractionPanelOpen}
        settings={appSettings}
        enabledModels={enabledModels}
        isSaving={isInteractionSaving}
        onClose={() => {
          setIsInteractionPanelOpen(false);
          setIsSettingsMenuOpen(true);
        }}
        onToggleShowChatAdaptationButtons={
          toggleShowChatAdaptationButtons
        }
        onToggleSingleChatAdaptationButton={
          toggleSingleChatAdaptationButton
        }
        onChangeTitleModel={changeTitleModel}
        onChangeSummaryModel={changeSummaryModel}
      />

      <AboutSettingsPanel
        open={isAboutPanelOpen}
        onClose={() => {
          setIsAboutPanelOpen(false);
          setIsSettingsMenuOpen(true);
        }}
      />

      <SettingsMenuPanel
        open={isSettingsMenuOpen}
        onClose={() => setIsSettingsMenuOpen(false)}
        onSelectSection={handleSelectSettingsSection}
      />
    </div>
  );
}
