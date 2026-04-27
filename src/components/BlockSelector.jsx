import { useMemo, useState, useRef, useEffect, useCallback } from "react";

export default function BlockSelector({
  blocks,
  focusedBlockSHA1,
  activeBlockSHA1,
  onSelectBlock,
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const listRef = useRef(null);
  const trackRef = useRef(null);
  const indicatorRef = useRef(null);
  const containerRef = useRef(null);
  const prevFocusedSHA1Ref = useRef("");
  const isTouchDevice = useRef(false);

  const displayBlocks = useMemo(() => {
    const filtered = blocks.filter((b) => b.role !== "user");

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
    if ((isHovered || isOpen) && focusedBlockSHA1 && listRef.current) {
      const focusedEl = listRef.current.querySelector(`[data-sha="${focusedBlockSHA1}"]`);
      focusedEl?.scrollIntoView({ block: "nearest" });
    }
  }, [isHovered, isOpen, focusedBlockSHA1]);

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

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside, { passive: true });
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const handleSelect = (sha1) => {
    onSelectBlock?.(sha1);
    setIsOpen(false);
  };

  const handleToggle = () => {
    isTouchDevice.current = true;
    setIsOpen((prev) => !prev);
  };

  const handleMouseEnter = () => {
    if (isTouchDevice.current) return;
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const showPanel = isHovered || isOpen;
  const focusedBlock = displayBlocks.find((b) => b.sha1 === focusedBlockSHA1);
  const focusedLabel = focusedBlock
    ? (focusedBlock.summaryInfo?.summary || focusedBlock.prompt?.slice(0, 20) || "")
    : "";

  return (
    <div
      className={`block-selector ${showPanel ? "expanded" : "collapsed"} ${disabled ? "disabled" : ""}`.trim()}
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="block-selector-inner">
        <div className="block-selector-track" ref={trackRef}>
          <div className="block-selector-indicator" ref={indicatorRef} />
        </div>

        <div className="block-selector-anchor">
          {!showPanel && (
            <button
              className="block-selector-label-btn"
              onClick={handleToggle}
              disabled={!focusedBlockSHA1}
              aria-haspopup="listbox"
              aria-expanded={showPanel}
            >
              <span className="block-selector-line" />
              {focusedLabel && <span className="block-selector-text">{focusedLabel}</span>}
            </button>
          )}
          {isOpen && (
            <button
              className="block-selector-label-btn"
              onClick={handleToggle}
              aria-haspopup="listbox"
              aria-expanded={showPanel}
            >
              <span className="block-selector-line" />
              {focusedLabel && <span className="block-selector-text">{focusedLabel}</span>}
            </button>
          )}
        </div>

        {showPanel && (
          <div className="block-selector-panel">
            <div className="block-selector-list" ref={listRef} role="listbox">
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
                      role="option"
                      aria-selected={isFocused}
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
