import { useCallback, useRef, useState } from "react";
import { useWorkStation } from "../../contexts/WorkStationContext";
import SessionCard from "./SessionCard";

export default function GroupColumn({
  group,
  sessions,
  position,
  zoom,
  onContextMenu,
  onPreview,
  onOpenBatchImport,
  onMove,
  onLayoutChange,
  isConnecting,
  connectionSource,
  onStartConnection,
  onCompleteConnection,
}) {
  const { updateGroup, deleteGroup, removeSessionFromGroup, addSessionToGroup } =
    useWorkStation();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [isCollapsed, setIsCollapsed] = useState(group.isCollapsed);
  const [columnWidth, setColumnWidth] = useState(group.columnWidth || 280);
  const [isResizing, setIsResizing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  const inputRef = useRef(null);
  const columnRef = useRef(null);

  // Handle rename
  const handleStartRename = useCallback(() => {
    setEditName(group.name);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [group.name]);

  const handleSaveRename = useCallback(async () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== group.name) {
      await updateGroup(group.id, { name: trimmed });
    }
    setIsEditing(false);
  }, [editName, group.id, group.name, updateGroup]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        handleSaveRename();
      } else if (e.key === "Escape") {
        setIsEditing(false);
      }
    },
    [handleSaveRename]
  );

  // Handle collapse (vertical: keep header, hide content)
  const handleToggleCollapse = useCallback(async () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    await updateGroup(group.id, { isCollapsed: next });
  }, [isCollapsed, group.id, updateGroup]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (window.confirm(`确定删除分组 "${group.name}" 吗？`)) {
      await deleteGroup(group.id);
    }
  }, [group.id, group.name, deleteGroup]);

  // Handle drag to move the whole group (from header)
  const handleMoveStart = useCallback(
    (e) => {
      // Ignore clicks on buttons / inputs inside the header
      if (e.target.closest("button, input")) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setIsMoving(true);

      const startX = e.clientX;
      const startY = e.clientY;
      const startPosX = position.x;
      const startPosY = position.y;

      const handleMove = (moveE) => {
        const nextX = startPosX + (moveE.clientX - startX) / zoom;
        const nextY = startPosY + (moveE.clientY - startY) / zoom;
        onMove(group.id, nextX, nextY);
      };

      const handleUp = async (upE) => {
        setIsMoving(false);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        const finalX = Math.round(startPosX + (upE.clientX - startX) / zoom);
        const finalY = Math.round(startPosY + (upE.clientY - startY) / zoom);
        await updateGroup(group.id, { posX: finalX, posY: finalY });
        onLayoutChange?.();
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [position.x, position.y, zoom, group.id, onMove, updateGroup, onLayoutChange]
  );

  // Handle width resize (right edge)
  const handleResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = columnWidth;
      let latestWidth = startWidth;

      const handleResizeMove = (moveE) => {
        const delta = (moveE.clientX - startX) / zoom;
        latestWidth = Math.max(200, Math.min(500, startWidth + delta));
        setColumnWidth(latestWidth);
      };

      const handleResizeEnd = async () => {
        setIsResizing(false);
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeEnd);
        await updateGroup(group.id, { columnWidth: Math.round(latestWidth) });
        onLayoutChange?.();
      };

      window.addEventListener("mousemove", handleResizeMove);
      window.addEventListener("mouseup", handleResizeEnd);
    },
    [columnWidth, zoom, group.id, updateGroup, onLayoutChange]
  );

  // Handle drag and drop (import session into group)
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setIsDragOver(false);

      const sessionHash = e.dataTransfer.getData("sessionHash");
      if (sessionHash) {
        await addSessionToGroup(sessionHash, group.id);
      }
    },
    [addSessionToGroup, group.id]
  );

  // Handle context menu
  const handleContextMenu = useCallback(
    (e) => {
      onContextMenu(e, {
        type: "group",
        groupId: group.id,
        groupName: group.name,
        onStartRename: handleStartRename,
        onDelete: handleDelete,
        onToggleCollapse: handleToggleCollapse,
      });
    },
    [group.id, group.name, onContextMenu, handleStartRename, handleDelete, handleToggleCollapse]
  );

  // Handle session drag start
  const handleSessionDragStart = useCallback((e, sessionHash) => {
    e.dataTransfer.setData("sessionHash", sessionHash);
  }, []);

  return (
    <div
      ref={columnRef}
      className={`group-column ${isCollapsed ? "collapsed" : ""} ${isDragOver ? "drag-over" : ""} ${isMoving ? "moving" : ""}`}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: columnWidth,
      }}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header (drag handle) */}
      <div className="group-column-header" onMouseDown={handleMoveStart}>
        {isEditing ? (
          <input
            ref={inputRef}
            className="group-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveRename}
            onKeyDown={handleKeyDown}
            maxLength={50}
          />
        ) : (
          <h3
            className="group-name"
            onDoubleClick={handleStartRename}
            title={group.name}
          >
            {group.name}
          </h3>
        )}

        <div className="group-header-actions">
          <button
            className="group-action-btn"
            onClick={() => onOpenBatchImport(group.id)}
            title="导入 session"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            className="group-action-btn"
            onClick={handleToggleCollapse}
            title={isCollapsed ? "展开" : "折叠"}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                transform: isCollapsed ? "rotate(180deg)" : "none",
              }}
            >
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sessions */}
      {!isCollapsed && (
        <div className="group-column-content">
          {sessions.length === 0 ? (
            <div className="group-empty">
              <p>暂无 session</p>
              <button
                className="import-btn"
                onClick={() => onOpenBatchImport(group.id)}
              >
                导入 session
              </button>
            </div>
          ) : (
            sessions.map((session) => (
              <SessionCard
                key={session.sessionHash}
                session={session}
                groupId={group.id}
                onContextMenu={onContextMenu}
                onPreview={onPreview}
                onDragStart={handleSessionDragStart}
                isConnecting={isConnecting}
                connectionSource={connectionSource}
                onStartConnection={onStartConnection}
                onCompleteConnection={onCompleteConnection}
                onRemoveFromGroup={removeSessionFromGroup}
              />
            ))
          )}
        </div>
      )}

      {/* Resize handles */}
      {!isCollapsed && (
        <div className="group-resize-handle" onMouseDown={handleResizeStart} />
      )}
    </div>
  );
}
