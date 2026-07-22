import { useCallback } from "react";
import { useWorkStation } from "../../contexts/WorkStationContext";

export default function SessionCard({
  session,
  groupId,
  onContextMenu,
  onPreview,
  onDragStart,
  isConnecting,
  connectionSource,
  onStartConnection,
  onCompleteConnection,
  onRemoveFromGroup,
}) {
  const { cleanupDeletedSession } = useWorkStation();

  const isDeleted = !!session.deletedAt;
  const isSource = connectionSource === session.sessionHash;

  // Handle double click to preview
  const handleDoubleClick = useCallback(() => {
    if (!isDeleted) {
      onPreview(session);
    }
  }, [isDeleted, onPreview, session]);

  // Handle drag start
  const handleDragStart = useCallback(
    (e) => {
      if (isDeleted) {
        e.preventDefault();
        return;
      }
      onDragStart(e, session.sessionHash);
    },
    [isDeleted, onDragStart, session.sessionHash]
  );

  // Handle click during connection mode
  const handleClick = useCallback(() => {
    if (isConnecting && !isSource) {
      onCompleteConnection(session.sessionHash);
    }
  }, [isConnecting, isSource, onCompleteConnection, session.sessionHash]);

  // Handle context menu
  const handleContextMenu = useCallback(
    (e) => {
      e.stopPropagation();
      onContextMenu(e, {
        type: "session",
        sessionHash: session.sessionHash,
        sessionTitle: session.title,
        groupId,
        isDeleted,
        onStartConnection: () => onStartConnection(session.sessionHash),
        onRemoveFromGroup: () => onRemoveFromGroup(session.sessionHash, groupId),
        onCleanupDeleted: () => cleanupDeletedSession(session.sessionHash),
      });
    },
    [
      session.sessionHash,
      session.title,
      groupId,
      isDeleted,
      onContextMenu,
      onStartConnection,
      onRemoveFromGroup,
      cleanupDeletedSession,
    ]
  );

  return (
    <div
      className={`session-card ${isDeleted ? "deleted" : ""} ${isConnecting ? "connecting" : ""} ${isSource ? "connection-source" : ""}`}
      data-session-hash={session.sessionHash}
      draggable={!isDeleted}
      onDragStart={handleDragStart}
      onDoubleClick={handleDoubleClick}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <div className="session-card-content">
        {isDeleted ? (
          <div className="session-deleted-placeholder">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>已删除</span>
          </div>
        ) : (
          <h4 className="session-title" title={session.title}>
            {session.title || "未命名会话"}
          </h4>
        )}
      </div>

      {/* Connection indicator */}
      {isConnecting && !isSource && !isDeleted && (
        <div className="session-connect-indicator">
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
        </div>
      )}
    </div>
  );
}
