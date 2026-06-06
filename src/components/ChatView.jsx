import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildReadableBlockOrder,
  countUnreadBlocks,
  getLatestReadableBlockSHA1,
  resolveReadCursor,
} from "../lib/chatReadingState";
import MessageList from "./MessageList";
import { extractPromptText } from "../lib/content";

function clampText(value = "", maxLength = 120) {
  const normalized = `${value ?? ""}`.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}...`;
}

function getLatestDescendantLeaf(startBlock, blockMap) {
  let currentBlock = startBlock;
  const visited = new Set();

  while (currentBlock?.sha1 && !visited.has(currentBlock.sha1)) {
    visited.add(currentBlock.sha1);

    const childBlockSHA1s = currentBlock.graphInfo?.childBlockSHA1s ?? [];

    if (childBlockSHA1s.length === 0) {
      break;
    }

    const nextBlock = blockMap.get(childBlockSHA1s[childBlockSHA1s.length - 1]) ?? null;

    if (!nextBlock) {
      break;
    }

    currentBlock = nextBlock;
  }

  return currentBlock ?? startBlock;
}

function buildBranchPreviews(graphBlocks = [], activeBlockSHA1 = "") {
  const blockMap = new Map(graphBlocks.map((block) => [block.sha1, block]));
  const activeBlock = blockMap.get(activeBlockSHA1) ?? null;
  const childBlockSHA1s = activeBlock?.graphInfo?.childBlockSHA1s ?? [];

  return childBlockSHA1s
    .map((childBlockSHA1, index) => {
      const childBlock = blockMap.get(childBlockSHA1) ?? null;

      if (!childBlock) {
        return null;
      }

      if (childBlock.adaptationInfo?.labels?.some((label) => label.key === "label.hidden")) {
        return null;
      }

      const latestLeaf = getLatestDescendantLeaf(childBlock, blockMap);
      const summaryText = latestLeaf.summaryInfo?.summary || childBlock.summaryInfo?.summary || "";
      const previewText =
        summaryText ||
        latestLeaf.response ||
        childBlock.response ||
        "这个分支还没有更多回复，可以点击进入后继续展开。";
      const stepCount = Math.max(
        (latestLeaf.graphInfo?.depth ?? childBlock.graphInfo?.depth ?? 0) -
          (activeBlock?.graphInfo?.depth ?? 0),
        1,
      );

      return {
        id: childBlock.sha1,
        order: index + 1,
        targetSHA1: childBlock.sha1,
        title: clampText(extractPromptText(childBlock.prompt) || "未命名分支", 40),
        preview: clampText(previewText, 120),
        meta:
          stepCount > 1
            ? `继续阅读 ${stepCount} 步，切换后会定位到该分支的最新块`
            : "切换后会定位到这个分支的最新对话块",
      };
    })
    .filter(Boolean);
}

function ChatBottomDock({
  showBranches,
  branchPreviews,
  onActivateBlock,
  branchPreviewGridRef,
  isBranchGridOverflowing,
  isLoading,
}) {
  if (!showBranches) {
    return null;
  }

  const isSingleBranch = branchPreviews.length === 1;
  const isMultiBranch = branchPreviews.length > 1;

  return (
    <div className="chat-bottom-dock-stack">
      {showBranches ? (
        <section
          className={`chat-bottom-dock-inline chat-bottom-dock-branches ${isSingleBranch ? "is-single-branch" : ""}`.trim()}
          aria-label="后续分支预览"
        >
          <div className="chat-bottom-dock-header">
            <span className="chat-bottom-dock-eyebrow">后续分支</span>
            <span className="chat-bottom-dock-caption">选择一段继续写下去的内容</span>
          </div>
          <div
            className={`chat-bottom-dock-grid ${isSingleBranch ? "is-single-branch" : ""} ${isMultiBranch ? "is-multi-branch" : ""} ${isBranchGridOverflowing ? "is-overflowing" : ""}`.trim()}
            ref={branchPreviewGridRef}
          >
            {branchPreviews.map((preview) => (
              <button
                key={preview.id}
                className={`branch-preview-flow-item ${isSingleBranch ? "is-single-branch" : ""}`.trim()}
                type="button"
                disabled={isLoading}
                onClick={() => onActivateBlock?.(preview.targetSHA1)}
              >
                <span className="branch-preview-flow-label">分支 {preview.order}</span>
                <span className="branch-preview-flow-title">{preview.title}</span>
                <span className="branch-preview-flow-text">{preview.preview}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const ChatView = memo(function ChatView({
  graphBlocks = [],
  activeBlockSHA1 = "",
  focusedBlockSHA1 = "",
  isReplyPending = false,
  bottomDockMode = "smart",
  hideWideScreenSideBranches = false,
  messages = [],
  navigationRequest = null,
  isLoading,
  hideChatBottomDock = false,
  onActivateBlock,
  onFocusBlock,
  ...props
}) {
  const messageListRef = useRef(null);
  const branchPreviewGridRef = useRef(null);
  const [readBlockSHA1, setReadBlockSHA1] = useState("");
  const readBlockSHA1Ref = useRef(readBlockSHA1);
  readBlockSHA1Ref.current = readBlockSHA1;
  const [isBranchGridOverflowing, setIsBranchGridOverflowing] = useState(false);
  const branchPreviews = useMemo(
    () => buildBranchPreviews(graphBlocks, activeBlockSHA1),
    [graphBlocks, activeBlockSHA1],
  );
  const readableBlockSHA1s = useMemo(() => buildReadableBlockOrder(messages), [messages]);
  const latestReadableBlockSHA1 = useMemo(
    () => getLatestReadableBlockSHA1(readableBlockSHA1s, activeBlockSHA1),
    [readableBlockSHA1s, activeBlockSHA1],
  );
  const resolvedReadBlockSHA1 = useMemo(
    () => resolveReadCursor(readableBlockSHA1s, readBlockSHA1, latestReadableBlockSHA1),
    [readableBlockSHA1s, readBlockSHA1, latestReadableBlockSHA1],
  );
  const unreadBlockCount = useMemo(
    () => countUnreadBlocks(readableBlockSHA1s, resolvedReadBlockSHA1),
    [readableBlockSHA1s, resolvedReadBlockSHA1],
  );
  const hasBranchPreviews = branchPreviews.length > 0;
  const canShowBranchPreview =
    bottomDockMode === "smart" || bottomDockMode === "branch-only";
  const showBranches =
    !isReplyPending &&
    !hideChatBottomDock &&
    bottomDockMode !== "hidden" &&
    hasBranchPreviews &&
    canShowBranchPreview;

  useEffect(() => {
    const gridElement = branchPreviewGridRef.current;

    if (!gridElement || !showBranches) {
      return undefined;
    }

    gridElement.scrollTo({ left: 0, behavior: "auto" });

    return undefined;
  }, [branchPreviews.length, showBranches, activeBlockSHA1]);

  useEffect(() => {
    const gridElement = branchPreviewGridRef.current;

    if (!gridElement || !showBranches) {
      setIsBranchGridOverflowing(false);
      return undefined;
    }

    const handleWheel = (event) => {
      if (gridElement.scrollWidth <= gridElement.clientWidth) {
        return;
      }

      const horizontalDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

      if (horizontalDelta === 0) {
        return;
      }

      event.preventDefault();
      gridElement.scrollBy({ left: horizontalDelta, behavior: "auto" });
    };

    gridElement.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      gridElement.removeEventListener("wheel", handleWheel);
    };
  }, [branchPreviews.length, showBranches]);

  useEffect(() => {
    const gridElement = branchPreviewGridRef.current;

    if (!gridElement || !showBranches) {
      setIsBranchGridOverflowing(false);
      return undefined;
    }

    const updateOverflowState = () => {
      setIsBranchGridOverflowing(gridElement.scrollWidth > gridElement.clientWidth + 1);
    };

    updateOverflowState();

    let resizeObserver;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateOverflowState);
      resizeObserver.observe(gridElement);
    }

    window.addEventListener("resize", updateOverflowState);

    return () => {
      window.removeEventListener("resize", updateOverflowState);
      resizeObserver?.disconnect();
    };
  }, [branchPreviews.length, showBranches]);

  useEffect(() => {
    setReadBlockSHA1((currentReadBlockSHA1) =>
      resolveReadCursor(readableBlockSHA1s, currentReadBlockSHA1, latestReadableBlockSHA1),
    );
  }, [readableBlockSHA1s, latestReadableBlockSHA1]);

  useEffect(() => {
    if (!navigationRequest?.id || !latestReadableBlockSHA1) {
      return;
    }

    setReadBlockSHA1(latestReadableBlockSHA1);
  }, [navigationRequest?.id, latestReadableBlockSHA1]);

  const handleReadBlockChange = useCallback(
    (nextReadBlockSHA1) => {
      const resolvedReadBlockSHA1 = resolveReadCursor(
        readableBlockSHA1s,
        nextReadBlockSHA1,
        latestReadableBlockSHA1 || readBlockSHA1Ref.current,
      );

      if (resolvedReadBlockSHA1 && resolvedReadBlockSHA1 !== focusedBlockSHA1) {
        onFocusBlock?.(resolvedReadBlockSHA1);
      }

      setReadBlockSHA1((currentReadBlockSHA1) =>
        resolvedReadBlockSHA1 === currentReadBlockSHA1
          ? currentReadBlockSHA1
          : resolvedReadBlockSHA1,
      );
    },
    [focusedBlockSHA1, latestReadableBlockSHA1, onFocusBlock, readableBlockSHA1s],
  );

  const handleActivateBranchPreview = useCallback(
    (targetSHA1) => {
      if (!targetSHA1 || isLoading) {
        return;
      }

      setReadBlockSHA1(targetSHA1);
      onActivateBlock?.(targetSHA1);
    },
    [isLoading, onActivateBlock],
  );

  return (
    <div className={`chat-view-shell ${hasBranchPreviews ? "has-branch-previews" : ""}`.trim()}>
      <MessageList
        {...props}
        ref={messageListRef}
        messages={messages}
        graphBlocks={graphBlocks}
        isLoading={isLoading}
        focusedBlockSHA1={focusedBlockSHA1}
        hideWideScreenSideBranches={hideWideScreenSideBranches}
        onActivateBlock={onActivateBlock}
        onFocusBlock={onFocusBlock}
        onReadBlockChange={handleReadBlockChange}
        scrollRequest={navigationRequest}
        bottomContent={showBranches ? (
          <ChatBottomDock
            showBranches={showBranches}
            branchPreviews={branchPreviews}
            isLoading={isLoading}
            onActivateBlock={handleActivateBranchPreview}
            branchPreviewGridRef={branchPreviewGridRef}
            isBranchGridOverflowing={isBranchGridOverflowing}
          />
        ) : null}
      />
    </div>
  );
});

export default ChatView;
