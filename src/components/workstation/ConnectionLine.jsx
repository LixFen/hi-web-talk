import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkStation } from "../../contexts/WorkStationContext";

// Unique marker IDs per connection to avoid SVG id collisions
let markerIdCounter = 0;
function useMarkerId() {
  const [id] = useState(() => `arrow-${++markerIdCounter}`);
  return id;
}

export default function ConnectionLine({ connection, zoom, layoutVersion, onContextMenu }) {
  const { updateConnection, deleteConnection } = useWorkStation();
  const markerId = useMarkerId();

  const [positions, setPositions] = useState({ source: null, target: null });

  useEffect(() => {
    const updatePositions = () => {
      const sourceEl = document.querySelector(
        `[data-session-hash="${connection.sourceSessionHash}"]`
      );
      const targetEl = document.querySelector(
        `[data-session-hash="${connection.targetSessionHash}"]`
      );

      if (sourceEl && targetEl) {
        const sourceRect = sourceEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const canvas = document.querySelector(".canvas-transform");
        if (canvas) {
          const canvasRect = canvas.getBoundingClientRect();
          const scale = zoom;
          const sourceCenterX = sourceRect.left + sourceRect.width / 2;
          const targetCenterX = targetRect.left + targetRect.width / 2;
          const sourceFromRight = sourceCenterX <= targetCenterX;
          const targetFromLeft = sourceCenterX <= targetCenterX;

          setPositions({
            source: {
              x: ((sourceFromRight ? sourceRect.right : sourceRect.left) - canvasRect.left) / scale,
              y: (sourceRect.top + sourceRect.height / 2 - canvasRect.top) / scale,
            },
            target: {
              x: ((targetFromLeft ? targetRect.left : targetRect.right) - canvasRect.left) / scale,
              y: (targetRect.top + targetRect.height / 2 - canvasRect.top) / scale,
            },
          });
        }
      }
    };

    updatePositions();
    window.addEventListener("resize", updatePositions);

    const sourceEl = document.querySelector(
      `[data-session-hash="${connection.sourceSessionHash}"]`
    );
    const targetEl = document.querySelector(
      `[data-session-hash="${connection.targetSessionHash}"]`
    );
    const resizeObserver = new ResizeObserver(updatePositions);
    if (sourceEl) resizeObserver.observe(sourceEl);
    if (targetEl) resizeObserver.observe(targetEl);

    return () => {
      window.removeEventListener("resize", updatePositions);
      resizeObserver.disconnect();
    };
  }, [connection.sourceSessionHash, connection.targetSessionHash, zoom, layoutVersion]);

  const handleDelete = useCallback(async () => {
    await deleteConnection(connection.id);
  }, [connection.id, deleteConnection]);

  const handleContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, {
        type: "connection",
        connectionId: connection.id,
        label: connection.label,
        annotation: connection.annotation,
        arrowType: connection.arrowType,
        onDelete: handleDelete,
      });
    },
    [connection.id, connection.label, connection.annotation, connection.arrowType, onContextMenu, handleDelete]
  );

  if (!positions.source || !positions.target) return null;

  // Curve calculation
  const dx = positions.target.x - positions.source.x;
  const controlOffset = Math.min(Math.abs(dx) * 0.3, 100);
  const sxDir = dx >= 0 ? 1 : -1;
  const txDir = dx >= 0 ? -1 : 1;

  const path = `M ${positions.source.x} ${positions.source.y} C ${
    positions.source.x + controlOffset * sxDir
  } ${positions.source.y}, ${positions.target.x + controlOffset * txDir} ${
    positions.target.y
  }, ${positions.target.x} ${positions.target.y}`;

  // Annotation rendering
  const annotation = connection.annotation || "";
  const midX = (positions.source.x + positions.target.x) / 2;
  const midY = (positions.source.y + positions.target.y) / 2;
  const lineWidth = Math.abs(dx);

  // Scale font: 12px default, shrink after 7 chars
  let fontSize = 12;
  if (annotation.length > 7) {
    fontSize = Math.max(8, 12 - (annotation.length - 7) * 0.5);
  }
  fontSize /= zoom;

  // Truncate if text wider than line (rough estimate: 0.6 * fontSize per char)
  const estimatedTextWidth = annotation.length * fontSize * 0.6;
  const displayAnnotation =
    estimatedTextWidth > lineWidth * 0.8
      ? annotation.slice(0, Math.floor((lineWidth * 0.8) / (fontSize * 0.6))) + "…"
      : annotation;

  // Arrow marker for this connection
  const arrowType = connection.arrowType || "forward";
  const markerColor = "var(--text-muted)";

  return (
    <g className="connection-line" onContextMenu={handleContextMenu}>
      {/* Invisible wider line for easier clicking */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={12 / zoom}
        style={{ cursor: "pointer" }}
      />

      {/* Visible line */}
      <path
        d={path}
        fill="none"
        stroke={markerColor}
        strokeWidth={2 / zoom}
        strokeDasharray={`${6 / zoom}`}
        markerEnd={arrowType === "forward" || arrowType === "bidirectional" ? `url(#${markerId})` : undefined}
        markerStart={arrowType === "reverse" || arrowType === "bidirectional" ? `url(#${markerId}-rev)` : undefined}
      />

      {/* Marker definitions */}
      <defs>
        {/* Forward arrow */}
        {(arrowType === "forward" || arrowType === "bidirectional") && (
          <marker
            id={markerId}
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={markerColor} />
          </marker>
        )}
        {/* Reverse arrow (at source end, points backward = toward source) */}
        {(arrowType === "reverse" || arrowType === "bidirectional") && (
          <marker
            id={`${markerId}-rev`}
            markerWidth="10"
            markerHeight="7"
            refX="0"
            refY="3.5"
            orient="auto"
          >
            <polygon points="10 0, 0 3.5, 10 7" fill={markerColor} />
          </marker>
        )}
      </defs>

      {/* Annotation */}
      {displayAnnotation && (
        <g transform={`translate(${midX}, ${midY})`} style={{ pointerEvents: "none" }}>
          <rect
            x={-(estimatedTextWidth > lineWidth * 0.8 ? lineWidth * 0.4 : estimatedTextWidth / 2 + 4 / zoom)}
            y={-fontSize * 0.8}
            width={estimatedTextWidth > lineWidth * 0.8 ? lineWidth * 0.8 : estimatedTextWidth + 8 / zoom}
            height={fontSize * 1.8}
            rx={3 / zoom}
            fill="var(--bg-elevated)"
            stroke="var(--border-color)"
            strokeWidth={0.5 / zoom}
          />
          <text
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--text-primary)"
            fontSize={fontSize}
            style={{ pointerEvents: "none" }}
          >
            {displayAnnotation}
          </text>
        </g>
      )}
    </g>
  );
}
