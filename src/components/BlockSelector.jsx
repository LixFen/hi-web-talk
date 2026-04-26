import { useMemo, useState, useRef, useEffect, useCallback } from "react";

export default function BlockSelector({
  blocks,
  focusedBlockSHA1,
  activeBlockSHA1,
  onSelectBlock,
  disabled = false,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const listRef = useRef(null);
  const trackRef = useRef(null);
  const indicatorRef = useRef(null);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const prevFocusedSHA1Ref = useRef("");

  const displayBlocks = useMemo(() => {
    const filtered = blocks.filter((b) => {
      if (b.role === "user") return false;
      return true;
    });

    if (!activeBlockSHA1) {
      return filtered.sort((a, b) => (a.graphInfo?.depth ?? 0) - (b.graphInfo?.depth ?? 0));
    }

    const activeChain = new Set();
    let currentSHA1 = activeBlockSHA1;
    while (currentSHA1) {
      activeChain.add(currentSHA1);
      const currentBlock = blocks.find((b) => b.sha1 === currentSHA1);
      currentSHA1 = currentBlock?.parentBlockSHA1 || null;
    }

    const chainBlocks = filtered.filter((b) => activeChain.has(b.sha1));
    return chainBlocks.sort((a, b) => (a.graphInfo?.depth ?? 0) - (b.graphInfo?.depth ?? 0));
  }, [blocks, activeBlockSHA1]);

  useEffect(() => {
    if (isHovered && focusedBlockSHA1 && listRef.current) {
      const focusedEl = listRef.current.querySelector(`[data-sha="${focusedBlockSHA1}"]`);
      focusedEl?.scrollIntoView({ block: "nearest" });
    }
  }, [isHovered, focusedBlockSHA1]);

  const updateIndicatorPosition = useCallback(() => {
    if (!trackRef.current || !indicatorRef.current || displayBlocks.length === 0) return;

    const focusedIndex = displayBlocks.findIndex((b) => b.sha1 === focusedBlockSHA1);
    if (focusedIndex === -1) return;

    const trackHeight = trackRef.current.offsetHeight;
    const indicatorHeight = indicatorRef.current.offsetHeight;
    const progress = displayBlocks.length > 1 ? focusedIndex / (displayBlocks.length - 1) : 0;
    const maxOffset = trackHeight - indicatorHeight;
    const offset = progress * maxOffset;

    indicatorRef.current.style.transform = `translateY(${offset}px)`;
  }, [displayBlocks, focusedBlockSHA1]);

  useEffect(() => {
    updateIndicatorPosition();
  }, [updateIndicatorPosition]);

  useEffect(() => {
    window.addEventListener("resize", updateIndicatorPosition);
    return () => window.removeEventListener("resize", updateIndicatorPosition);
  }, [updateIndicatorPosition]);

  const handleSelect = (sha1) => {
    onSelectBlock?.(sha1);
  };

  const focusedBlock = displayBlocks.find((b) => b.sha1 === focusedBlockSHA1);
  const focusedLabel = focusedBlock
    ? (focusedBlock.summaryInfo?.summary || focusedBlock.prompt?.slice(0, 20) || "")
    : "";

  return (
    <div
      className={`block-selector ${isHovered ? "expanded" : "collapsed"} ${disabled ? "disabled" : ""}`.trim()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      <div className="block-selector-inner">
        <div className="block-selector-track" ref={trackRef}>
          <div className="block-selector-indicator" ref={indicatorRef} />
        </div>

        <div className="block-selector-anchor" ref={anchorRef}>
          {!isHovered && (
            <button
              className="block-selector-label-btn"
              onClick={() => focusedBlockSHA1 && handleSelect(focusedBlockSHA1)}
              disabled={!focusedBlockSHA1}
            >
              <span className="block-selector-line" />
              {focusedLabel && <span className="block-selector-text">{focusedLabel}</span>}
            </button>
          )}
        </div>

        {isHovered && (
          <div className="block-selector-panel" ref={panelRef}>
            <div className="block-selector-list" ref={listRef}>
              {displayBlocks.length === 0 ? (
                <div className="block-selector-empty">暂无对话块</div>
              ) : (
                displayBlocks.map((block) => {
                  const isActive = block.sha1 === activeBlockSHA1;
                  const isFocused = block.sha1 === focusedBlockSHA1;
                  return (
                    <button
                      key={block.sha1}
                      className={`block-selector-item ${isActive ? "active" : ""} ${isFocused ? "focused" : ""}`.trim()}
                      data-sha={block.sha1}
                      onClick={() => handleSelect(block.sha1)}
                    >
                      <span className="block-selector-item-label">
                        {block.summaryInfo?.summary || block.prompt?.slice(0, 40) + "..."}
                      </span>
                      {isFocused && <span className="block-selector-item-badge">当前</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
