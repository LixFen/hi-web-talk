import { useCallback, useEffect, useRef, useState } from "react";

export default function TopBar({
  zoom,
  onZoomChange,
  onZoomReset,
  onBack,
  isConnecting,
  onCancelConnection,
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const handle = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isSettingsOpen]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    onZoomChange(0.1);
  }, [onZoomChange]);

  const handleZoomOut = useCallback(() => {
    onZoomChange(-0.1);
  }, [onZoomChange]);

  return (
    <div className="workstation-topbar">
      {/* Left section */}
      <div className="topbar-left">
        <button
          className="topbar-back-btn"
          onClick={onBack}
          title="返回聊天"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <h1 className="topbar-title">WorkStation</h1>
      </div>

      {/* Center section - connection mode indicator */}
      {isConnecting && (
        <div className="topbar-center">
          <div className="connection-mode-indicator">
            <span>连线模式</span>
            <span className="connection-hint">点击目标 session 创建连线</span>
            <button
              className="connection-cancel-btn"
              onClick={onCancelConnection}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Right section */}
      <div className="topbar-right">
        <div className="zoom-controls">
          <button
            className="zoom-btn"
            onClick={handleZoomOut}
            title="缩小"
            disabled={zoom <= 0.3}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <button
            className="zoom-level"
            onClick={onZoomReset}
            title="重置缩放"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            className="zoom-btn"
            onClick={handleZoomIn}
            title="放大"
            disabled={zoom >= 2}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
        </div>

        <div className="topbar-hint">
          <span>Ctrl + 滚轮缩放</span>
          <span>左键拖动画布</span>
        </div>

        <div ref={settingsRef} style={{ position: "relative" }}>
          <button
            className="topbar-settings-btn"
            onClick={() => setIsSettingsOpen((p) => !p)}
            title="WorkStation 设置"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {isSettingsOpen && (
            <div className="topbar-settings-dropdown">
              <div className="topbar-settings-item" onClick={() => { onZoomReset(); setIsSettingsOpen(false); }}>
                重置视图
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
