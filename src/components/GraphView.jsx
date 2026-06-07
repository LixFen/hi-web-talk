import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BlockCard from "./BlockCard";
import ContextMenu from "./ContextMenu";
import { extractPromptText } from "../lib/content";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 96;
const COLUMN_GAP = 56;
const ROW_GAP = 64;
const PADDING_X = 28;
const PADDING_Y = 28;

const NODE_WIDTH_COMPACT = 140;
const NODE_HEIGHT_COMPACT = 40;
const COLUMN_GAP_COMPACT = 28;
const ROW_GAP_COMPACT = 28;

function buildGraphLayout(blocks, zoomLevel = 1) {
  if (blocks.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const isCompact = zoomLevel === 0;
  const nodeW = isCompact ? NODE_WIDTH_COMPACT : NODE_WIDTH;
  const nodeH = isCompact ? NODE_HEIGHT_COMPACT : NODE_HEIGHT;
  const colGap = isCompact ? COLUMN_GAP_COMPACT : COLUMN_GAP;
  const rowGap = isCompact ? ROW_GAP_COMPACT : ROW_GAP;
  const padX = isCompact ? 16 : PADDING_X;
  const padY = isCompact ? 16 : PADDING_Y;

  const childrenByParent = new Map();

  for (const block of blocks) {
    if (!block.parentBlockSHA1) {
      continue;
    }

    const siblings = childrenByParent.get(block.parentBlockSHA1) ?? [];
    siblings.push(block);
    siblings.sort((left, right) => {
      const compareResult = left.createdAt.localeCompare(right.createdAt);
      return compareResult !== 0 ? compareResult : left.sha1.localeCompare(right.sha1);
    });
    childrenByParent.set(block.parentBlockSHA1, siblings);
  }

  const rootBlock = blocks.find((block) => block.parentBlockSHA1 === null) ?? blocks[0];
  const placement = new Map();
  let columnCursor = 0;
  let maxDepth = 0;

  function placeNode(block, depth) {
    maxDepth = Math.max(maxDepth, depth);
    const children = childrenByParent.get(block.sha1) ?? [];

    if (children.length === 0) {
      const column = columnCursor;
      columnCursor += 1;
      placement.set(block.sha1, { depth, column });
      return column;
    }

    const childColumns = children.map((child) => placeNode(child, depth + 1));
    const column =
      childColumns.reduce((total, current) => total + current, 0) / childColumns.length;
    placement.set(block.sha1, { depth, column });
    return column;
  }

  placeNode(rootBlock, 0);

  const nodes = blocks
    .map((block) => {
      const position = placement.get(block.sha1) ?? { depth: 0, column: 0 };

      return {
        ...block,
        x: padX + position.column * (nodeW + colGap),
        y: padY + position.depth * (nodeH + rowGap),
      };
    })
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const nodePositions = new Map(nodes.map((node) => [node.sha1, node]));
  const edges = nodes
    .filter((node) => node.parentBlockSHA1)
    .map((node) => ({
      id: `${node.parentBlockSHA1}-${node.sha1}`,
      from: nodePositions.get(node.parentBlockSHA1),
      to: node,
    }))
    .filter((edge) => edge.from && edge.to);

  return {
    nodes,
    edges,
    nodeW,
    nodeH,
    width:
      padX * 2 +
      Math.max(columnCursor, 1) * nodeW +
      Math.max(columnCursor - 1, 0) * colGap,
    height: padY * 2 + (maxDepth + 1) * nodeH + maxDepth * rowGap,
  };
}

function getNodeSnippet(block) {
  if (block.blockType === "system") {
    return extractPromptText(block.prompt);
  }

  return extractPromptText(block.prompt) || block.response || "空内容";
}

function getCommandLabel(definition, adaptationInfo) {
  if (definition.key === "summary.generate") {
    const status = adaptationInfo?.summaryGenerationStatus ?? "idle";

    if (status === "pending") {
      return "摘要生成中";
    }

    if (status === "completed") {
      return "刷新摘要";
    }

    if (status === "failed") {
      return "重试摘要";
    }
  }

  return definition.shortLabel;
}

const GraphView = memo(function GraphView(props) {
  const { blocks = [], isLoading, onActivateBlock, onFocusBlock, graph, focusedBlockSHA1 = "", adaptationDefinitions = [], onBranchFromBlock, onRegenerate, onToggleAdaptation, onRunAdaptation } = props;
  const canvasScrollRef = useRef(null);
  const selectedNodeRef = useRef(null);
  const zoomAnchorRef = useRef(null);
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
    hasMoved: false,
    suppressClick: false,
  });
  const [isDetailCollapsed, setIsDetailCollapsed] = useState(true);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedSHA1, setSelectedSHA1] = useState(
    focusedBlockSHA1 || graph?.rootBlockSHA1 || blocks[0]?.sha1 || "",
  );
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, block: null });

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.visible ? { visible: false, x: 0, y: 0, block: null } : prev));
  }, []);

  const handleOpenContextMenu = useCallback((block, x, y) => {
    setContextMenu({ visible: true, x, y, block });
  }, []);

  useEffect(() => {
    const fallbackSHA1 = focusedBlockSHA1 || graph?.rootBlockSHA1 || blocks[0]?.sha1 || "";
    setSelectedSHA1((currentSelectedSHA1) => {
      if (fallbackSHA1 && currentSelectedSHA1 === fallbackSHA1) {
        return currentSelectedSHA1;
      }

      if (currentSelectedSHA1 && blocks.some((block) => block.sha1 === currentSelectedSHA1)) {
        if (currentSelectedSHA1 === focusedBlockSHA1) {
          return currentSelectedSHA1;
        }
      }

      return fallbackSHA1;
    });
  }, [blocks, focusedBlockSHA1, graph?.rootBlockSHA1]);

  useEffect(() => {
    const element = selectedNodeRef.current;

    if (!element) {
      return;
    }

    element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
  }, [selectedSHA1, focusedBlockSHA1, blocks.length]);

  useEffect(() => {
    if (!isDraggingCanvas) {
      return undefined;
    }

    function finishDrag() {
      const dragState = dragStateRef.current;

      if (!dragState.isDragging) {
        return;
      }

      dragState.isDragging = false;
      dragState.suppressClick = dragState.hasMoved;
      setIsDraggingCanvas(false);
    }

    function handleMouseMove(event) {
      const dragState = dragStateRef.current;

      if (!dragState.isDragging) {
        return;
      }

      const scrollElement = canvasScrollRef.current;

      if (!scrollElement) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;

      if (!dragState.hasMoved && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
        dragState.hasMoved = true;
      }

      scrollElement.scrollLeft = dragState.startScrollLeft - deltaX;
      scrollElement.scrollTop = dragState.startScrollTop - deltaY;
      event.preventDefault();
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finishDrag);
    window.addEventListener("blur", finishDrag);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finishDrag);
      window.removeEventListener("blur", finishDrag);
    };
  }, [isDraggingCanvas]);

  useEffect(() => {
    const scrollElement = canvasScrollRef.current;

    if (!scrollElement) {
      return undefined;
    }

    function handleWheel(event) {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;

      setZoomLevel((current) => {
        const next = current + direction;

        if (next < 0 || next > 1) {
          return current;
        }

        const rect = scrollElement.getBoundingClientRect();
        const canvas = scrollElement.querySelector(".graph-canvas");
        const contentW = canvas ? canvas.scrollWidth : scrollElement.scrollWidth;
        const contentH = canvas ? canvas.scrollHeight : scrollElement.scrollHeight;

        zoomAnchorRef.current = {
          next,
          ratioX: (scrollElement.scrollLeft + (event.clientX - rect.left)) / contentW,
          ratioY: (scrollElement.scrollTop + (event.clientY - rect.top)) / contentH,
        };

        return next;
      });
    }

    scrollElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => scrollElement.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const anchor = zoomAnchorRef.current;

    if (!anchor) {
      return;
    }

    zoomAnchorRef.current = null;
    const scrollElement = canvasScrollRef.current;

    if (!scrollElement) {
      return;
    }

    requestAnimationFrame(() => {
      const canvas = scrollElement.querySelector(".graph-canvas");
      const contentW = canvas ? canvas.scrollWidth : scrollElement.scrollWidth;
      const contentH = canvas ? canvas.scrollHeight : scrollElement.scrollHeight;
      const rect = scrollElement.getBoundingClientRect();

      scrollElement.scrollLeft = anchor.ratioX * contentW - rect.width / 2;
      scrollElement.scrollTop = anchor.ratioY * contentH - rect.height / 2;
    });
  }, [zoomLevel]);

  function handleCanvasMouseDown(event) {
    if (event.button !== 0) {
      return;
    }

    if (event.target instanceof Element && event.target.closest(".graph-node")) {
      return;
    }

    const scrollElement = canvasScrollRef.current;

    if (!scrollElement) {
      return;
    }

    dragStateRef.current = {
      isDragging: true,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scrollElement.scrollLeft,
      startScrollTop: scrollElement.scrollTop,
      hasMoved: false,
      suppressClick: false,
    };

    setIsDraggingCanvas(true);
    event.preventDefault();
  }

  function handleCanvasClickCapture(event) {
    const dragState = dragStateRef.current;

    if (!dragState.suppressClick) {
      return;
    }

    dragState.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const toolbarDefinitions = useMemo(
    () => adaptationDefinitions.filter((definition) => definition.ui?.placement === "message-toolbar"),
    [adaptationDefinitions],
  );

  const contextMenuItems = useMemo(() => {
    const contextBlock = contextMenu.block;
    if (!contextBlock) return [];

    const items = [];
    const branchInfo = contextBlock.branchInfo;
    const adaptationInfo = contextBlock.adaptationInfo;
    const isSystemBlock = contextBlock.blockType === "system";

    if (branchInfo && !isSystemBlock) {
      items.push({
        key: "continue-from-here",
        label: "从这里继续",
        disabled: isLoading || branchInfo.isActiveBlock,
        onClick: () => onBranchFromBlock?.(contextBlock.sha1),
      });

      if (branchInfo.previousBranchHeadSHA1) {
        items.push({
          key: "prev-branch",
          label: "上一分支",
          disabled: isLoading,
          onClick: () => onActivateBlock?.(branchInfo.previousBranchHeadSHA1),
        });
      }

      if (branchInfo.nextBranchHeadSHA1) {
        items.push({
          key: "next-branch",
          label: "下一分支",
          disabled: isLoading,
          onClick: () => onActivateBlock?.(branchInfo.nextBranchHeadSHA1),
        });
      }

      items.push({
        key: "regenerate",
        label: "重新生成",
        disabled: isLoading,
        onClick: () => onRegenerate?.(contextBlock.sha1),
      });
    }

    if (adaptationInfo && toolbarDefinitions.length > 0 && !isSystemBlock) {
      if (items.length > 0) {
        items.push({ key: "sep-adapt", separator: true });
      }

      for (const definition of toolbarDefinitions) {
        const currentRecord = adaptationInfo.byKey?.[definition.key];
        const isActive = Boolean(currentRecord?.enabled);
        const isCommand = definition.kind === "command";
        const isPendingCommand =
          definition.key === "summary.generate" &&
          adaptationInfo.summaryGenerationStatus === "pending";

        if (isCommand) {
          items.push({
            key: definition.key,
            label: getCommandLabel(definition, adaptationInfo),
            disabled: isLoading || isPendingCommand,
            onClick: () => onRunAdaptation?.(contextBlock.sha1, definition.key),
          });
        } else {
          items.push({
            key: definition.key,
            label: definition.shortLabel,
            checked: isActive,
            disabled: isLoading,
            onClick: () => onToggleAdaptation?.(contextBlock.sha1, definition.key, !isActive),
          });
        }
      }
    }

    return items;
  }, [contextMenu.block, isLoading, toolbarDefinitions, onBranchFromBlock, onActivateBlock, onRegenerate, onToggleAdaptation, onRunAdaptation]);

  const importantNodeSHA1s = useMemo(
    () =>
      new Set(
        blocks
          .filter((block) =>
            block.adaptationInfo?.labels?.some((label) => label.key === "label.important"),
          )
          .map((block) => block.sha1),
      ),
    [blocks],
  );

  const hiddenNodeSHA1s = useMemo(
    () =>
      new Set(
        blocks
          .filter((block) =>
            block.adaptationInfo?.labels?.some((label) => label.key === "label.hidden"),
          )
          .map((block) => block.sha1),
      ),
    [blocks],
  );

  const hiddenCount = hiddenNodeSHA1s.size;

  if (blocks.length === 0) {
    return (
      <div className="view-empty-state">
        <h2>还没有图结构可以展示</h2>
        <p>创建会话后，这里会直接显示整张 Session / Block 图。</p>
      </div>
    );
  }

  const visibleBlocks = showHidden ? blocks : blocks.filter((block) => !hiddenNodeSHA1s.has(block.sha1));
  const layout = buildGraphLayout(visibleBlocks, zoomLevel);
  const selectedBlock = blocks.find((block) => block.sha1 === selectedSHA1) ?? blocks[0];
  const isCompact = zoomLevel === 0;
  const { nodeW, nodeH } = layout;

  return (
    <div className={`graph-view-shell ${isDetailCollapsed ? "detail-collapsed" : ""}`}>
      <div className={`graph-canvas-panel ${isCompact ? "zoomed-out" : ""}`}>
        {isDetailCollapsed ? (
          <button
            type="button"
            className="graph-detail-toggle-btn"
            onClick={() => setIsDetailCollapsed(false)}
            aria-label="展开节点详情"
          >
            展开详情
          </button>
        ) : null}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className={`graph-hidden-toggle-btn ${showHidden ? "active" : ""}`}
            onClick={() => setShowHidden((v) => !v)}
            aria-label={showHidden ? "隐藏已标记分支" : "显示已标记分支"}
          >
            {showHidden ? "隐藏分支" : `显示隐藏 (${hiddenCount})`}
          </button>
        ) : null}
        <div className="graph-zoom-indicator" aria-hidden="true">
          {["紧凑", "标准"][zoomLevel]}
        </div>
        <div
          className={`graph-canvas-scroll ${isDraggingCanvas ? "dragging" : ""}`.trim()}
          ref={canvasScrollRef}
          onMouseDown={handleCanvasMouseDown}
          onClickCapture={handleCanvasClickCapture}
        >
          <div className="graph-canvas" style={{ width: `${layout.width}px`, height: `${layout.height}px` }}>
            <svg className="graph-svg" width={layout.width} height={layout.height}>
              {layout.edges.map((edge) => {
                const startX = edge.from.x + nodeW / 2;
                const startY = edge.from.y + nodeH;
                const endX = edge.to.x + nodeW / 2;
                const endY = edge.to.y;
                const middleY = startY + (endY - startY) / 2;
                const path = `M ${startX} ${startY} C ${startX} ${middleY}, ${endX} ${middleY}, ${endX} ${endY}`;
                const isImportant =
                  importantNodeSHA1s.has(edge.from.sha1) && importantNodeSHA1s.has(edge.to.sha1);
                const isHidden =
                  hiddenNodeSHA1s.has(edge.from.sha1) || hiddenNodeSHA1s.has(edge.to.sha1);

                return (
                  <path
                    key={edge.id}
                    d={path}
                    className={`graph-edge ${isImportant ? "important" : ""} ${isHidden ? "hidden-edge" : ""}`}
                  />
                );
              })}
            </svg>

            {layout.nodes.map((node) => {
              const isImportant = importantNodeSHA1s.has(node.sha1);
              const isHidden = hiddenNodeSHA1s.has(node.sha1);
              const modelLabel = node.blockType === "system" ? "system" : node.modelAlias || "dialogue";

              return (
              <button
                key={node.sha1}
                ref={selectedSHA1 === node.sha1 ? selectedNodeRef : null}
                data-node-sha1={node.sha1}
                type="button"
                className={`graph-node ${isCompact ? "compact" : ""} ${selectedSHA1 === node.sha1 ? "selected" : ""} ${node.graphInfo?.isActiveBlock ? "active" : ""} ${node.sha1 === focusedBlockSHA1 ? "focused" : ""} ${node.graphInfo?.isInActiveChain ? "in-chain" : ""} ${isImportant ? "important" : ""} ${isHidden ? "hidden-node" : ""}`}
                style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${nodeW}px`, height: `${nodeH}px` }}
                disabled={isLoading}
                onClick={() => {
                  setSelectedSHA1(node.sha1);
                  if (!isHidden) {
                    onActivateBlock?.(node.sha1);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  handleOpenContextMenu(node, event.clientX, event.clientY);
                }}
              >
                {isCompact ? (
                  <span className="graph-node-compact-label">{node.sha1.slice(0, 6)}</span>
                ) : (
                  <>
                    {isImportant ? (
                      <div className="graph-node-important-badge" aria-label="重要标记">
                        <svg width="14" height="14" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
                          <path
                            stroke="currentColor"
                            strokeWidth="2.5"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M13 3l2.7 5.5 6 .9-4.3 4.2 1 6.1L13 17.4 7.6 19.7l1-6.1L4.3 9.4l6-.9Z"
                          />
                        </svg>
                      </div>
                    ) : null}
                    <div className="graph-node-title-row">
                      <span className="graph-node-type">{modelLabel}</span>
                      <span className="graph-node-sha">{node.sha1.slice(0, 6)}</span>
                    </div>
                    <div className="graph-node-content">{getNodeSnippet(node)}</div>
                    <div className="graph-node-footer">
                      <span>深度 {node.graphInfo?.depth ?? 0}</span>
                      <span>子节点 {node.graphInfo?.childCount ?? 0}</span>
                    </div>
                  </>
                )}
              </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="graph-detail-panel">
        <div className="graph-detail-header">
          <div>
            <div className="settings-eyebrow">Block Detail</div>
            <h2 className="settings-panel-title">当前选中节点</h2>
          </div>
          <button
            type="button"
            className="graph-detail-toggle-btn"
            onClick={() => setIsDetailCollapsed(true)}
            aria-label="收起节点详情"
          >
            收起
          </button>
        </div>
        <div className="graph-detail-card-wrapper">
          <BlockCard
            block={selectedBlock}
            className="graph-detail-card"
            isFocused={selectedBlock?.sha1 === focusedBlockSHA1}
            {...props}
          />
        </div>
      </div>
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />
    </div>
  );
});

export default GraphView;
