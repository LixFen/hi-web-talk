import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WorkStationProvider, useWorkStation } from "../contexts/WorkStationContext";
import { useLocale } from "../contexts/LocaleContext";
import Canvas from "../components/workstation/Canvas";
import TopBar from "../components/workstation/TopBar";
import UngroupedDrawer from "../components/workstation/UngroupedDrawer";
import PreviewModal from "../components/workstation/PreviewModal";
import BatchImportModal from "../components/workstation/BatchImportModal";
import WorkstationContextMenu from "../components/workstation/WorkstationContextMenu";
import DevTools from "../components/workstation/DevTools";

function WorkStationContent() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const {
    groups,
    groupSessions,
    ungroupedSessions,
    connections,
    isLoading,
    error,
    setError,
    createConnection,
  } = useWorkStation();

  // Canvas state
  const [zoom, setZoom] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem("ws-zoom"));
      return Number.isFinite(v) ? Math.min(Math.max(v, 0.3), 2) : 1;
    } catch { return 1; }
  });
  const [pan, setPan] = useState(() => {
    try {
      const raw = localStorage.getItem("ws-pan");
      if (!raw) return { x: 0, y: 0 };
      const p = JSON.parse(raw);
      return { x: Number(p.x) || 0, y: Number(p.y) || 0 };
    } catch { return { x: 0, y: 0 }; }
  });

  // Persist zoom and pan
  useEffect(() => {
    try { localStorage.setItem("ws-zoom", String(zoom)); } catch {}
  }, [zoom]);
  useEffect(() => {
    try { localStorage.setItem("ws-pan", JSON.stringify(pan)); } catch {}
  }, [pan]);
  // Bumped when a group moves/resizes so connection lines recalc positions
  const [layoutVersion, setLayoutVersion] = useState(0);
  const bumpLayout = useCallback(() => setLayoutVersion((v) => v + 1), []);

  // UI state
  const [previewSession, setPreviewSession] = useState(null);
  const [isBatchImportOpen, setIsBatchImportOpen] = useState(false);
  const [batchImportGroupId, setBatchImportGroupId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionSource, setConnectionSource] = useState(null);
  const [connectionSourceGroupId, setConnectionSourceGroupId] = useState(null);

  // Ungrouped drawer state (persisted to localStorage)
  const [isUngroupedOpen, setIsUngroupedOpen] = useState(() => {
    try {
      return localStorage.getItem("ws-ungrouped-open") !== "false";
    } catch {
      return true;
    }
  });
  const [ungroupedWidth, setUngroupedWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("ws-ungrouped-width");
      return saved ? Number(saved) : 240;
    } catch {
      return 240;
    }
  });

  // Persist ungrouped drawer state
  useEffect(() => {
    try {
      localStorage.setItem("ws-ungrouped-open", String(isUngroupedOpen));
    } catch {}
  }, [isUngroupedOpen]);

  useEffect(() => {
    try {
      localStorage.setItem("ws-ungrouped-width", String(ungroupedWidth));
    } catch {}
  }, [ungroupedWidth]);

  // Handle zoom
  const handleZoom = useCallback((delta) => {
    setZoom((prev) => {
      const next = prev + delta;
      return Math.min(Math.max(next, 0.3), 2);
    });
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Handle context menu
  const handleContextMenu = useCallback((e, data) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      ...data,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Handle connection mode
  const handleStartConnection = useCallback((sessionHash, groupId = null) => {
    setIsConnecting(true);
    setConnectionSource(sessionHash);
    setConnectionSourceGroupId(groupId);
  }, []);

  const handleCompleteConnection = useCallback(
    async (targetSessionHash, targetGroupId = null) => {
      if (connectionSource && targetSessionHash !== connectionSource) {
        try {
          await createConnection(connectionSource, targetSessionHash, "", connectionSourceGroupId, targetGroupId);
        } catch {}
      }
      setIsConnecting(false);
      setConnectionSource(null);
      setConnectionSourceGroupId(null);
    },
    [connectionSource, connectionSourceGroupId, createConnection]
  );

  const handleCancelConnection = useCallback(() => {
    setIsConnecting(false);
    setConnectionSource(null);
    setConnectionSourceGroupId(null);
  }, []);

  // Handle preview
  const handlePreview = useCallback((session) => {
    setPreviewSession(session);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewSession(null);
  }, []);

  // Handle batch import
  const handleOpenBatchImport = useCallback((groupId) => {
    setBatchImportGroupId(groupId);
    setIsBatchImportOpen(true);
  }, []);

  const handleCloseBatchImport = useCallback(() => {
    setIsBatchImportOpen(false);
    setBatchImportGroupId(null);
  }, []);

  // Handle back navigation
  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // Handle error dismiss
  const handleDismissError = useCallback(() => {
    setError(null);
  }, [setError]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (isConnecting) {
          handleCancelConnection();
        } else if (previewSession) {
          handleClosePreview();
        } else if (contextMenu) {
          handleCloseContextMenu();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isConnecting,
    previewSession,
    contextMenu,
    handleCancelConnection,
    handleClosePreview,
    handleCloseContextMenu,
  ]);

  // Loading state
  if (isLoading) {
    return (
      <div className="workstation-loading">
        <div className="workstation-loading-spinner" />
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="workstation-container">
      <TopBar
        zoom={zoom}
        onZoomChange={handleZoom}
        onZoomReset={handleZoomReset}
        onBack={handleBack}
        isConnecting={isConnecting}
        onCancelConnection={handleCancelConnection}
      />

      <div className="workstation-main">
        <UngroupedDrawer
          sessions={ungroupedSessions}
          isOpen={isUngroupedOpen}
          width={ungroupedWidth}
          onToggle={() => setIsUngroupedOpen((prev) => !prev)}
          onWidthChange={setUngroupedWidth}
          onContextMenu={handleContextMenu}
          onPreview={handlePreview}
          isConnecting={isConnecting}
          connectionSource={connectionSource}
          onCompleteConnection={handleCompleteConnection}
        />

        <Canvas
          groups={groups}
          groupSessions={groupSessions}
          connections={connections}
          zoom={zoom}
          pan={pan}
          layoutVersion={layoutVersion}
          onLayoutChange={bumpLayout}
          onPanChange={setPan}
          onZoom={handleZoom}
          onContextMenu={handleContextMenu}
          onPreview={handlePreview}
          onOpenBatchImport={handleOpenBatchImport}
          isConnecting={isConnecting}
          connectionSource={connectionSource}
          connectionSourceGroupId={connectionSourceGroupId}
          onStartConnection={handleStartConnection}
          onCompleteConnection={handleCompleteConnection}
          onCancelConnection={handleCancelConnection}
        />
      </div>

      {contextMenu && (
        <WorkstationContextMenu
          {...contextMenu}
          onClose={handleCloseContextMenu}
          onOpenBatchImport={handleOpenBatchImport}
        />
      )}

      {previewSession && (
        <PreviewModal
          session={previewSession}
          onClose={handleClosePreview}
        />
      )}

      {isBatchImportOpen && (
        <BatchImportModal
          groupId={batchImportGroupId}
          onClose={handleCloseBatchImport}
        />
      )}

      {error && (
        <div className="workstation-error-toast">
          <span>{error}</span>
          <button onClick={handleDismissError}>×</button>
        </div>
      )}

      <DevTools />
    </div>
  );
}

export default function WorkStationPage() {
  return (
    <WorkStationProvider>
      <WorkStationContent />
    </WorkStationProvider>
  );
}
