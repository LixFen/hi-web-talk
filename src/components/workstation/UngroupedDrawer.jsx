import { useCallback, useRef, useState } from "react";
import SessionCard from "./SessionCard";

export default function UngroupedDrawer({
  sessions,
  isOpen,
  width,
  onToggle,
  onWidthChange,
  onContextMenu,
  onPreview,
  isConnecting,
  connectionSource,
  onCompleteConnection,
}) {
  const [isResizing, setIsResizing] = useState(false);
  const drawerRef = useRef(null);

  // Handle resize
  const handleResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = width;

      const handleResizeMove = (moveE) => {
        const delta = moveE.clientX - startX;
        const newWidth = Math.max(180, Math.min(400, startWidth + delta));
        onWidthChange(newWidth);
      };

      const handleResizeEnd = () => {
        setIsResizing(false);
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeEnd);
      };

      window.addEventListener("mousemove", handleResizeMove);
      window.addEventListener("mouseup", handleResizeEnd);
    },
    [width, onWidthChange]
  );

  // Handle drag and drop (sessions can be dropped back to ungrouped)
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragOver(false);
      // Dropping to ungrouped means removing from all groups
      // This is handled by the parent via removeSessionFromGroup
    },
    []
  );

  // Handle context menu
  const handleContextMenu = useCallback(
    (e) => {
      onContextMenu(e, { type: "ungrouped" });
    },
    [onContextMenu]
  );

  return (
    <div
      ref={drawerRef}
      className={`ungrouped-drawer ${isOpen ? "open" : "closed"} ${isDragOver ? "drag-over" : ""}`}
      style={{ width: isOpen ? width : 40 }}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toggle button */}
      <button
        className="drawer-toggle"
        onClick={onToggle}
        title={isOpen ? "折叠未分组" : "展开未分组"}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transform: isOpen ? "rotate(0deg)" : "rotate(180deg)",
          }}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Header */}
      {isOpen && (
        <div className="drawer-header">
          <h3 className="drawer-title">未分组</h3>
          <span className="drawer-count">{sessions.length}</span>
        </div>
      )}

      {/* Sessions */}
      {isOpen && (
        <div className="drawer-content">
          {sessions.length === 0 ? (
            <div className="drawer-empty">
              <p>所有 session 已分组</p>
            </div>
          ) : (
            sessions.map((session) => (
              <SessionCard
                key={session.sessionHash}
                session={session}
                groupId={null}
                onContextMenu={onContextMenu}
                onPreview={onPreview}
                onDragStart={(e, hash) => {
                  e.dataTransfer.setData("sessionHash", hash);
                }}
                isConnecting={isConnecting}
                connectionSource={connectionSource}
                onStartConnection={() => {}}
                onCompleteConnection={onCompleteConnection}
                onRemoveFromGroup={() => {}}
              />
            ))
          )}
        </div>
      )}

      {/* Resize handle */}
      {isOpen && (
        <div
          className="drawer-resize-handle"
          onMouseDown={handleResizeStart}
        />
      )}
    </div>
  );
}
