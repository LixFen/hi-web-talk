import { useCallback, useEffect, useRef, useState } from "react";
import GroupColumn from "./GroupColumn";
import ConnectionLine from "./ConnectionLine";

export default function Canvas({
  groups,
  groupSessions,
  connections,
  zoom,
  pan,
  layoutVersion,
  onLayoutChange,
  onPanChange,
  onZoom,
  onContextMenu,
  onPreview,
  onOpenBatchImport,
  isConnecting,
  connectionSource,
  onStartConnection,
  onCompleteConnection,
  onCancelConnection,
}) {
  const canvasRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  // Local live positions during a group drag (id -> {x, y})
  const [movingPos, setMovingPos] = useState({});

  // Fallback grid position for groups without a stored posX/posY.
  // ponytail: movingPos overrides persist for the session; single-user so no cross-client sync needed.
  const getGroupPosition = useCallback(
    (group, index) => {
      if (movingPos[group.id]) return movingPos[group.id];
      if (group.posX != null && group.posY != null) {
        return { x: group.posX, y: group.posY };
      }
      // Fallback: lay out in a row so they don't stack at the origin
      return { x: 40 + index * 320, y: 40 };
    },
    [movingPos]
  );

  const handleGroupMove = useCallback((groupId, x, y) => {
    setMovingPos((prev) => ({ ...prev, [groupId]: { x, y } }));
    onLayoutChange?.();
  }, [onLayoutChange]);

  // Handle mouse wheel for zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        onZoom(delta);
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [onZoom]);

  // Handle pan
  const handleMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      if (isConnecting) return;

      // Only start panning if clicking on canvas background
      if (e.target === canvasRef.current || e.target.classList.contains("canvas-background")) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [isConnecting, pan]
  );

  const handleMouseMove = useCallback(
    (e) => {
      // Track mouse position for connection line
      if (isConnecting) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          setMousePos({
            x: (e.clientX - rect.left - pan.x) / zoom,
            y: (e.clientY - rect.top - pan.y) / zoom,
          });
        }
      }

      // Handle panning
      if (isPanning) {
        onPanChange({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    },
    [isConnecting, isPanning, panStart, pan, zoom, onPanChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Handle canvas context menu
  const handleContextMenu = useCallback(
    (e) => {
      if (e.target === canvasRef.current || e.target.classList.contains("canvas-background")) {
        onContextMenu(e, { type: "canvas" });
      }
    },
    [onContextMenu]
  );

  // Handle click to cancel connection
  const handleClick = useCallback(
    (e) => {
      if (isConnecting) {
        // Cancel if clicking on canvas background
        if (e.target === canvasRef.current || e.target.classList.contains("canvas-background")) {
          onCancelConnection();
        }
      }
    },
    [isConnecting, onCancelConnection]
  );

  // Get connection source position
  const getConnectionSourcePos = useCallback(() => {
    if (!connectionSource) return null;
    const el = document.querySelector(`[data-session-hash="${connectionSource}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return null;
    return {
      x: (rect.right - canvasRect.left - pan.x) / zoom,
      y: (rect.top + rect.height / 2 - canvasRect.top - pan.y) / zoom,
    };
  }, [connectionSource, pan, zoom]);

  const sourcePos = getConnectionSourcePos();

  return (
    <div
      ref={canvasRef}
      className={`workstation-canvas ${isConnecting ? "connecting" : ""} ${isPanning ? "panning" : ""}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      <div
        className="canvas-transform"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {/* SVG layer for connections */}
        <svg className="canvas-connections" style={{ overflow: "visible" }}>
          {connections.map((conn) => (
            <ConnectionLine
              key={conn.id}
              connection={conn}
              zoom={zoom}
              layoutVersion={layoutVersion}
              onContextMenu={onContextMenu}
            />
          ))}

          {/* Active connection line */}
          {isConnecting && sourcePos && (
            <line
              x1={sourcePos.x}
              y1={sourcePos.y}
              x2={mousePos.x}
              y2={mousePos.y}
              className="connection-line-active"
              stroke="var(--accent-color)"
              strokeWidth={2 / zoom}
              strokeDasharray={`${6 / zoom}`}
            />
          )}
        </svg>

        {/* Group columns (absolutely positioned) */}
        <div className="canvas-columns">
          {groups.map((group, index) => (
            <GroupColumn
              key={group.id}
              group={group}
              sessions={groupSessions[group.id] || []}
              position={getGroupPosition(group, index)}
              zoom={zoom}
              onContextMenu={onContextMenu}
              onPreview={onPreview}
              onOpenBatchImport={onOpenBatchImport}
              onMove={handleGroupMove}
              onLayoutChange={onLayoutChange}
              isConnecting={isConnecting}
              connectionSource={connectionSource}
              onStartConnection={onStartConnection}
              onCompleteConnection={onCompleteConnection}
            />
          ))}
        </div>
      </div>

      {/* Empty state */}
      {groups.length === 0 && (
        <div className="canvas-empty-state">
          <div className="empty-state-icon">
            <svg
              viewBox="0 0 24 24"
              width="48"
              height="48"
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          </div>
          <h3>暂无分组</h3>
          <p>右键点击画布创建第一个分组，然后从聊天页面导入 session</p>
        </div>
      )}
    </div>
  );
}
