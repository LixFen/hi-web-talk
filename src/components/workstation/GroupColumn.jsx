import { useCallback, useMemo, useRef, useState } from "react";
import { useWorkStation } from "../../contexts/WorkStationContext";
import SessionCard from "./SessionCard";

export const CARD_W = 220;
export const CARD_H = 140;
export const CARD_GAP = 16;

export function getGridPosition(index, containerWidth) {
  const cols = Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_W + CARD_GAP)));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: col * (CARD_W + CARD_GAP), y: row * (CARD_H + CARD_GAP) };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ponytail: brute-force spiral scan, O(rings * others) — fine for the handful
// of cards a group realistically holds. Swap for a spatial index if that changes.
export function findFreeSpot(x, y, w, h, others) {
  const step = 20;
  for (let ring = 0; ring < 40; ring++) {
    const offsets = ring === 0 ? [[0, 0]] : [];
    if (ring > 0) {
      for (let i = -ring; i <= ring; i++) {
        offsets.push([i, -ring], [i, ring]);
      }
      for (let i = -ring + 1; i <= ring - 1; i++) {
        offsets.push([-ring, i], [ring, i]);
      }
    }
    for (const [dx, dy] of offsets) {
      const candidate = { x: x + dx * step, y: Math.max(0, y + dy * step), w, h };
      if (!others.some((o) => overlaps(candidate, o))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }
  return { x, y };
}

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
  const {
    updateGroup,
    deleteGroup,
    removeSessionFromGroup,
    addSessionToGroup,
    updateSessionPosition,
  } = useWorkStation();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [isCollapsed, setIsCollapsed] = useState(group.isCollapsed);
  const [columnWidth, setColumnWidth] = useState(group.columnWidth || 280);
  const [sessionHeight, setSessionHeight] = useState(group.height || null);
  const [isResizing, setIsResizing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  const isAreaMode = group.viewMode === "area";

  const inputRef = useRef(null);
  const columnRef = useRef(null);

  // Effective per-card position: stored posX/posY/width/height, else a grid fallback
  const areaPositions = useMemo(() => {
    const map = {};
    sessions.forEach((s, i) => {
      if (s.posX != null && s.posY != null) {
        map[s.sessionHash] = {
          x: s.posX,
          y: s.posY,
          w: s.width || CARD_W,
          h: s.height || CARD_H,
        };
      } else {
        const grid = getGridPosition(i, columnWidth);
        map[s.sessionHash] = { x: grid.x, y: grid.y, w: CARD_W, h: CARD_H };
      }
    });
    return map;
  }, [sessions, columnWidth]);

  const areaContentHeight = useMemo(() => {
    if (!isAreaMode) return null;
    let maxBottom = 0;
    Object.values(areaPositions).forEach((p) => {
      maxBottom = Math.max(maxBottom, p.y + p.h);
    });
    return maxBottom + CARD_GAP;
  }, [isAreaMode, areaPositions]);

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

  // Handle view mode toggle (list <-> area)
  const handleToggleViewMode = useCallback(async () => {
    const next = isAreaMode ? "list" : "area";
    if (next === "area") {
      // Migrating list -> area: persist a grid position for any session missing one
      await Promise.all(
        sessions.map((s, i) => {
          if (s.posX != null && s.posY != null) return null;
          const grid = getGridPosition(i, columnWidth);
          return updateSessionPosition(s.sessionHash, group.id, {
            posX: grid.x,
            posY: grid.y,
            width: CARD_W,
            height: CARD_H,
          });
        })
      );
    }
    await updateGroup(group.id, { viewMode: next });
  }, [isAreaMode, sessions, columnWidth, group.id, updateGroup, updateSessionPosition]);

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

  // Handle session height resize (bottom edge)
  const handleBottomResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);

      const startY = e.clientY;
      const count = sessions.length || 1;
      const startH = sessionHeight || 60;
      let latestH = startH;

      // Directly patch card DOM to avoid React re-render during drag
      const applyHeight = (h) => {
        const cards = columnRef.current?.querySelectorAll(".session-card");
        cards?.forEach((card) => {
          card.style.height = `${h}px`;
          card.style.overflow = "hidden";
        });
      };

      const handleResizeMove = (moveE) => {
        const delta = (moveE.clientY - startY) / zoom / count;
        latestH = Math.max(40, Math.min(200, startH + delta));
        applyHeight(latestH);
      };

      const handleResizeEnd = async () => {
        setIsResizing(false);
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeEnd);
        setSessionHeight(latestH);
        await updateGroup(group.id, { height: Math.round(latestH) });
        onLayoutChange?.();
      };

      window.addEventListener("mousemove", handleResizeMove);
      window.addEventListener("mouseup", handleResizeEnd);
    },
    [sessionHeight, sessions.length, zoom, group.id, updateGroup, onLayoutChange]
  );

  // Handle card drag (area mode: free x/y reposition)
  const handleCardDragStart = useCallback(
    (sessionHash, e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const current = areaPositions[sessionHash] || { x: 0, y: 0, w: CARD_W, h: CARD_H };
      const startX = e.clientX;
      const startY = e.clientY;
      let latest = { x: current.x, y: current.y };

      const card = columnRef.current?.querySelector(
        `.session-card[data-session-hash="${sessionHash}"]`
      );

      const handleMove = (moveE) => {
        const dx = (moveE.clientX - startX) / zoom;
        const dy = (moveE.clientY - startY) / zoom;
        latest = { x: Math.max(0, current.x + dx), y: Math.max(0, current.y + dy) };
        if (card) {
          card.style.left = `${latest.x}px`;
          card.style.top = `${latest.y}px`;
        }
      };

      const handleUp = async () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);

        const others = sessions
          .filter((s) => s.sessionHash !== sessionHash)
          .map((s) => areaPositions[s.sessionHash])
          .filter(Boolean);
        const resolved = findFreeSpot(
          Math.round(latest.x),
          Math.round(latest.y),
          current.w,
          current.h,
          others
        );
        if (card) {
          card.style.left = `${resolved.x}px`;
          card.style.top = `${resolved.y}px`;
        }
        await updateSessionPosition(sessionHash, group.id, {
          posX: resolved.x,
          posY: resolved.y,
        });
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [areaPositions, sessions, zoom, group.id, updateSessionPosition]
  );

  // Handle card resize (area mode: independent per-card size)
  const handleCardResizeStart = useCallback(
    (sessionHash, e) => {
      e.preventDefault();
      e.stopPropagation();

      const current = areaPositions[sessionHash] || { x: 0, y: 0, w: CARD_W, h: CARD_H };
      const startX = e.clientX;
      const startY = e.clientY;
      let latest = { w: current.w, h: current.h };

      const card = columnRef.current?.querySelector(
        `.session-card[data-session-hash="${sessionHash}"]`
      );

      const handleMove = (moveE) => {
        const dw = (moveE.clientX - startX) / zoom;
        const dh = (moveE.clientY - startY) / zoom;
        latest = {
          w: Math.max(140, Math.min(400, current.w + dw)),
          h: Math.max(50, Math.min(300, current.h + dh)),
        };
        if (card) {
          card.style.width = `${latest.w}px`;
          card.style.height = `${latest.h}px`;
        }
      };

      const handleUp = async () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
        await updateSessionPosition(sessionHash, group.id, {
          width: Math.round(latest.w),
          height: Math.round(latest.h),
        });
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [areaPositions, zoom, group.id, updateSessionPosition]
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
      if (!sessionHash) return;

      if (isAreaMode) {
        const rect = columnRef.current?.getBoundingClientRect();
        const dropX = rect ? (e.clientX - rect.left) / zoom : 0;
        const dropY = rect ? (e.clientY - rect.top) / zoom : 0;
        const others = sessions.map((s) => areaPositions[s.sessionHash]).filter(Boolean);
        const resolved = findFreeSpot(
          Math.round(dropX - CARD_W / 2),
          Math.round(dropY - CARD_H / 2),
          CARD_W,
          CARD_H,
          others
        );
        await addSessionToGroup(sessionHash, group.id);
        await updateSessionPosition(sessionHash, group.id, {
          posX: Math.max(0, resolved.x),
          posY: Math.max(0, resolved.y),
          width: CARD_W,
          height: CARD_H,
        });
      } else {
        await addSessionToGroup(sessionHash, group.id);
      }
    },
    [isAreaMode, zoom, sessions, areaPositions, addSessionToGroup, group.id, updateSessionPosition]
  );

  // Handle context menu
  const handleContextMenu = useCallback(
    (e) => {
      onContextMenu(e, {
        type: "group",
        groupId: group.id,
        groupName: group.name,
        viewMode: group.viewMode,
        onStartRename: handleStartRename,
        onDelete: handleDelete,
        onToggleCollapse: handleToggleCollapse,
        onToggleViewMode: handleToggleViewMode,
      });
    },
    [
      group.id,
      group.name,
      group.viewMode,
      onContextMenu,
      handleStartRename,
      handleDelete,
      handleToggleCollapse,
      handleToggleViewMode,
    ]
  );

  // Handle session drag start
  const handleSessionDragStart = useCallback((e, sessionHash) => {
    e.dataTransfer.setData("sessionHash", sessionHash);
  }, []);

  return (
    <div
      ref={columnRef}
      className={`group-column ${isCollapsed ? "collapsed" : ""} ${isDragOver ? "drag-over" : ""} ${isMoving ? "moving" : ""}`}
      data-group-id={group.id}
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
        <div
          className={isAreaMode ? "group-area-content" : "group-column-content"}
          style={isAreaMode ? { height: areaContentHeight } : undefined}
        >
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
                sessionHeight={sessionHeight}
                onContextMenu={onContextMenu}
                onPreview={onPreview}
                onDragStart={handleSessionDragStart}
                isConnecting={isConnecting}
                connectionSource={connectionSource}
                onStartConnection={onStartConnection}
                onCompleteConnection={onCompleteConnection}
                onRemoveFromGroup={removeSessionFromGroup}
                areaMode={isAreaMode}
                posX={areaPositions[session.sessionHash]?.x}
                posY={areaPositions[session.sessionHash]?.y}
                cardWidth={areaPositions[session.sessionHash]?.w}
                cardHeight={areaPositions[session.sessionHash]?.h}
                onDragMoveStart={handleCardDragStart}
                onResizeStart={handleCardResizeStart}
              />
            ))
          )}
        </div>
      )}

      {/* Resize handles */}
      {!isCollapsed && (
        <>
          <div className="group-resize-handle" onMouseDown={handleResizeStart} />
          {!isAreaMode && (
            <div className="group-resize-handle-bottom" onMouseDown={handleBottomResizeStart} />
          )}
        </>
      )}
    </div>
  );
}
