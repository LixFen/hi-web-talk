import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SafeMarkdown from "./SafeMarkdown";
import { getAttachmentUrl } from "../lib/chatApi";
import ContextMenu from "./ContextMenu";
import { useApp } from "../contexts/AppContext";

const READ_MARKER_SELECTOR = "[data-read-block-sha1]";
const READ_MARKER_ROOT_MARGIN = "0px 0px -35% 0px";
const READ_SWITCH_HYSTERESIS = 0.02;
const READ_SWITCH_MIN_INTERVAL_MS = 40;

function getDirectionalAnchorY(containerRect, direction) {
  const height = Math.max(containerRect.height, 1);

  if (direction === "down") {
    return containerRect.top + height * 0.42;
  }

  if (direction === "up") {
    return containerRect.top + height * 0.58;
  }

  return containerRect.top + height * 0.5;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildReadBlockCandidates(markers, containerRect, anchorY) {
  const candidates = [];

  for (const marker of markers) {
    const blockSHA1 = marker.getAttribute("data-read-block-sha1");

    if (!blockSHA1) {
      continue;
    }

    const row = marker.closest(".message-row");
    const rowRect = row?.getBoundingClientRect();

    if (!rowRect || rowRect.height <= 0) {
      continue;
    }

    const overlapTop = Math.max(rowRect.top, containerRect.top);
    const overlapBottom = Math.min(rowRect.bottom, containerRect.bottom);
    const overlapHeight = overlapBottom - overlapTop;

    if (overlapHeight <= 0) {
      continue;
    }

    const visibilityRatio = clamp(overlapHeight / rowRect.height, 0, 1);
    const rowCenterY = (rowRect.top + rowRect.bottom) / 2;
    const distance = Math.abs(rowCenterY - anchorY);
    const normalizedDistance = distance / Math.max(containerRect.height, 1);
    const intersectsAnchor = rowRect.top <= anchorY && rowRect.bottom >= anchorY;
    const score = normalizedDistance - visibilityRatio * 0.35;

    candidates.push({
      blockSHA1,
      score,
      intersectsAnchor,
      visibilityRatio,
      rowTop: rowRect.top,
      rowBottom: rowRect.bottom,
    });
  }

  return candidates;
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

function normalizeFlowSnippet(value = "", maxLength = 72) {
  const compact = `${value ?? ""}`.replace(/\s+/g, " ").trim();

  if (!compact) {
    return "";
  }

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1)}...`;
}

function truncateFlowMarkdown(value = "", maxLength = 720) {
  const normalized = `${value ?? ""}`.trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}...`;
}

function escapeMarkdownInline(value = "") {
  return `${value ?? ""}`.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, "\\$&");
}

function buildBranchFlowTextFromGraph(branchHeadSHA1, blockMap, fallbackReply = "") {
  const branchHead = branchHeadSHA1 ? blockMap.get(branchHeadSHA1) : null;

  if (!branchHead) {
    const fallbackText = truncateFlowMarkdown(fallbackReply, 420);
    return fallbackText ? `**AI**\n\n${fallbackText}` : "切换分支继续阅读";
  }

  const userInput = normalizeFlowSnippet(branchHead.prompt || "", 160);
  const assistantText = truncateFlowMarkdown(
    branchHead.response || branchHead.summaryInfo?.summary || "",
    680,
  );

  if (userInput && assistantText) {
    return `**用户**\n\n${escapeMarkdownInline(userInput)}\n\n**AI**\n\n${assistantText}`;
  }

  if (assistantText) {
    return `**AI**\n\n${assistantText}`;
  }

  if (userInput) {
    return `**用户**\n\n${escapeMarkdownInline(userInput)}`;
  }

  return "切换分支继续阅读";
}

function ContinueFromHereIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
      style={{ pointerEvents: "none" }}
    >
      <g transform="translate(1 1)">
        <path
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 6h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7l-4.5 3v-3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z"
        />
        <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M7 12h7" />
        <path
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 9l3 3-3 3"
        />
      </g>
    </svg>
  );
}

function PreviousBranchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
      style={{ pointerEvents: "none" }}
    >
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M22 13H6" />
      <path
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6l-6 7 6 7"
      />
    </svg>
  );
}

function NextBranchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
      style={{ pointerEvents: "none" }}
    >
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 13h16" />
      <path
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 6l8 7-8 7"
      />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
      style={{ pointerEvents: "none" }}
    >
      <path
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 10a9 9 0 1 0 1 5"
      />
      <path
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 4v7h-7"
      />
    </svg>
  );
}

function IgnoreContextIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
    >
      <path
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2 13s4-5 11-5 11 5 11 5-4 5-11 5-11-5-11-5Z"
      />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 22L22 4" />
    </svg>
  );
}

function PreferSummaryIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
    >
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 6h12" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 12h8" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 18h6" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M18 4v8" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M14 8h8" />
    </svg>
  );
}

function PinSummaryIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
    >
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M16 4l6 6" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M18 6l-7 7" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M11 13L6 22" />
    </svg>
  );
}

function GenerateSummaryIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
    >
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 6h12" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 12h8" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 18h5" />
      <path
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 16l2.5 2.5L23 13"
      />
    </svg>
  );
}

function ImportantIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
    >
      <path
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 3l2.7 5.5 6 .9-4.3 4.2 1 6.1L13 17.4 7.6 19.7l1-6.1L4.3 9.4l6-.9Z"
      />
    </svg>
  );
}

function PendingOrganizeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
      className="message-action-icon-svg"
    >
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 6h12" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 12h10" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 18h7" />
      <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M18 10v10" />
      <path
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 17l3 3 3-3"
      />
    </svg>
  );
}

function getAdaptationButtonIcon(definitionKey) {
  if (definitionKey === "context.ignore") {
    return <IgnoreContextIcon />;
  }

  if (definitionKey === "summary.prefer") {
    return <PreferSummaryIcon />;
  }

  if (definitionKey === "summary.pin") {
    return <PinSummaryIcon />;
  }

  if (definitionKey === "summary.generate") {
    return <GenerateSummaryIcon />;
  }

  if (definitionKey === "important" || definitionKey === "label.important") {
    return <ImportantIcon />;
  }

  if (definitionKey === "pending.organize" || definitionKey === "label.review") {
    return <PendingOrganizeIcon />;
  }

  return null;
}



function areRowPropsEqual(prevProps, nextProps) {
  return (
    prevProps.msg.id === nextProps.msg.id &&
    prevProps.msg.text === nextProps.msg.text &&
    prevProps.msg.reasoning === nextProps.msg.reasoning &&
    prevProps.isFocused === nextProps.isFocused &&
    prevProps.isLoading === nextProps.isLoading
  );
}

function ReasoningIcon({ isOpen }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.2s var(--ease-out-expo)",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ReasoningPanel({ reasoning, defaultOpen = false, isStreaming = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (!reasoning || reasoning.trim().length === 0) {
    return null;
  }

  return (
    <div className="reasoning-panel">
      <button
        className="reasoning-panel-header"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <span className="reasoning-panel-title">
          <ReasoningIcon isOpen={isOpen} />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
            <path d="M9 21h6" />
          </svg>
          {isStreaming ? "思考中..." : "已深度思考"}
        </span>
      </button>
      {isOpen ? (
        <div className="reasoning-panel-content">
          <SafeMarkdown className="reasoning-markdown">
            {reasoning}
          </SafeMarkdown>
        </div>
      ) : null}
    </div>
  );
}

const MemoMessageRow = React.memo(({
  msg,
  isFocused,
  isLoading,
  hideWideScreenSideBranches,
  graphBlockMap,
  visibleToolbarDefinitions,
  onActivateBlock,
  onBranchFromBlock,
  onRegenerate,
  onToggleAdaptation,
  onRunAdaptation,
  onContextMenu,
}) => {
  const branchInfo = msg.branchInfo;
  const adaptationInfo = msg.adaptationInfo;
  const summaryInfo = msg.summaryInfo;
  const shouldShowSideBranchText = !hideWideScreenSideBranches;
  const hasPreviousBranch = Boolean(
    shouldShowSideBranchText && branchInfo?.previousBranchHeadSHA1,
  );
  const hasNextBranch = Boolean(
    shouldShowSideBranchText && branchInfo?.nextBranchHeadSHA1,
  );
  const previousBranchFlowText = buildBranchFlowTextFromGraph(
    branchInfo?.previousBranchHeadSHA1,
    graphBlockMap,
    msg.text,
  );
  const nextBranchFlowText = buildBranchFlowTextFromGraph(
    branchInfo?.nextBranchHeadSHA1,
    graphBlockMap,
    msg.text,
  );
  const isStreaming = msg.id === "pending-assistant-message";

  const handleContextMenu = (event) => {
    const hasSelection = window.getSelection()?.toString().length > 0;
    if (msg.role !== "assistant" || !msg.blockSHA1) {
      if (!hasSelection) return;
    }
    event.preventDefault();
    onContextMenu(msg, event.clientX, event.clientY);
  };

  return (
    <div
      className={`message-row ${msg.role} ${isFocused ? "focused" : ""}`.trim()}
      onContextMenu={handleContextMenu}
    >
      {msg.role === "assistant" ? (
        <div className="message-row-assistant-shell">
          {hasPreviousBranch ? (
            <aside className="message-side-branch message-side-branch-left">
              <button
                className="message-side-branch-btn"
                type="button"
                disabled={isLoading}
                onClick={() => onActivateBlock?.(branchInfo?.previousBranchHeadSHA1)}
                aria-label="上一分支"
                title="上一分支"
              >
                <span className="message-side-branch-kicker">上一分支</span>
                <SafeMarkdown className="message-side-branch-text">
                  {previousBranchFlowText}
                </SafeMarkdown>
              </button>
            </aside>
          ) : null}

          <div className="message-bubble">
            <div className="message-assistant-body" id={`msg-body-${msg.id}`}>
              <ReasoningPanel reasoning={msg.reasoning} defaultOpen={isStreaming} isStreaming={isStreaming} />

              <SafeMarkdown>
                {msg.text}
              </SafeMarkdown>

              {summaryInfo?.status === "completed" && summaryInfo.summary ? (
                <div className="summary-panel">
                  <div className="summary-panel-title">摘要</div>
                  <div className="summary-panel-content">{summaryInfo.summary}</div>
                </div>
              ) : null}

              {(branchInfo || adaptationInfo) ? (
                <div className="message-tools">
                  <div className="message-badges">
                    {branchInfo?.siblingCount > 1 ? (
                      <span className="branch-badge">
                        分支 {branchInfo.siblingIndex}/{branchInfo.siblingCount}
                      </span>
                    ) : null}
                    {branchInfo?.childCount > 0 ? (
                      <span className="branch-badge">后继 {branchInfo.childCount}</span>
                    ) : null}
                    {branchInfo?.isActiveBlock ? (
                      <span className="branch-badge active">当前链尾</span>
                    ) : null}
                    {adaptationInfo?.contextIgnore ? (
                      <span className="adaptation-badge">忽略上下文</span>
                    ) : null}
                    {adaptationInfo?.summaryPreferred ? (
                      <span className="adaptation-badge">优先摘要</span>
                    ) : null}
                    {adaptationInfo?.summaryPinned ? (
                      <span className="adaptation-badge">固定摘要</span>
                    ) : null}
                    {adaptationInfo?.labels?.map((label) => (
                      <span key={label.key} className="adaptation-badge label">
                        {label.label}
                      </span>
                    ))}
                    {summaryInfo?.status ? (
                      <span className={`adaptation-badge summary ${summaryInfo.status}`}>
                        摘要 {summaryInfo.status}
                      </span>
                    ) : null}
                  </div>

                  {branchInfo ? (
                    <div className="message-actions">
                      <button
                        className="message-action-btn message-action-btn-icon"
                        type="button"
                        disabled={isLoading || branchInfo.isActiveBlock}
                        onClick={() => onBranchFromBlock?.(msg.blockSHA1)}
                        aria-label="从这里继续"
                        title="从这里继续"
                      >
                        <ContinueFromHereIcon />
                        <span className="message-action-btn-label">从这里继续</span>
                      </button>
                      <button
                        className="message-action-btn message-action-btn-icon message-action-btn-branch-inline"
                        type="button"
                        disabled={isLoading || !branchInfo.previousBranchHeadSHA1}
                        onClick={() => onActivateBlock?.(branchInfo.previousBranchHeadSHA1)}
                        aria-label="上一分支"
                        title="上一分支"
                      >
                        <PreviousBranchIcon />
                        <span className="message-action-btn-label">上一分支</span>
                      </button>
                      <button
                        className="message-action-btn message-action-btn-icon message-action-btn-branch-inline"
                        type="button"
                        disabled={isLoading || !branchInfo.nextBranchHeadSHA1}
                        onClick={() => onActivateBlock?.(branchInfo.nextBranchHeadSHA1)}
                        aria-label="下一分支"
                        title="下一分支"
                      >
                        <NextBranchIcon />
                        <span className="message-action-btn-label">下一分支</span>
                      </button>
                      <button
                        className="message-action-btn message-action-btn-icon"
                        type="button"
                        disabled={isLoading}
                        onClick={() => onRegenerate?.(msg.blockSHA1)}
                        aria-label="重新生成"
                        title="重新生成"
                      >
                        <RegenerateIcon />
                        <span className="message-action-btn-label">重新生成</span>
                      </button>
                    </div>
                  ) : null}

                  {adaptationInfo && visibleToolbarDefinitions.length > 0 ? (
                    <div className="message-actions adaptation-actions">
                      {visibleToolbarDefinitions.map((definition) => {
                        const currentRecord = adaptationInfo.byKey?.[definition.key];
                        const isActive = Boolean(currentRecord?.enabled);
                        const isCommand = definition.kind === "command";
                        const isPendingCommand =
                          definition.key === "summary.generate" &&
                          adaptationInfo.summaryGenerationStatus === "pending";
                        const buttonLabel = isCommand
                          ? getCommandLabel(definition, adaptationInfo)
                          : definition.shortLabel;
                        const buttonIcon = getAdaptationButtonIcon(definition.key);

                        return (
                          <button
                            key={definition.key}
                            className={`message-action-btn adaptation-action-btn ${buttonIcon ? "message-action-btn-icon" : ""} ${isActive ? "selected" : ""}`.trim()}
                            type="button"
                            disabled={isLoading || isPendingCommand}
                            aria-label={buttonLabel}
                            title={buttonLabel}
                            onClick={() =>
                              isCommand
                                ? onRunAdaptation?.(msg.blockSHA1, definition.key)
                                : onToggleAdaptation?.(msg.blockSHA1, definition.key, !isActive)
                            }
                          >
                            {buttonIcon || buttonLabel}
                            {buttonIcon ? (
                              <span className="message-action-btn-label">{buttonLabel}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {msg.blockSHA1 ? (
                <div
                  className="message-read-marker"
                  data-read-block-sha1={msg.blockSHA1}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>

          {hasNextBranch ? (
            <aside className="message-side-branch message-side-branch-right">
              <button
                className="message-side-branch-btn"
                type="button"
                disabled={isLoading}
                onClick={() => onActivateBlock?.(branchInfo?.nextBranchHeadSHA1)}
                aria-label="下一分支"
                title="下一分支"
              >
                <span className="message-side-branch-kicker">下一分支</span>
                <SafeMarkdown className="message-side-branch-text">
                  {nextBranchFlowText}
                </SafeMarkdown>
              </button>
            </aside>
          ) : null}
        </div>
      ) : (
        <div className="message-bubble">
          {Array.isArray(msg.content) ? (
            <div className="message-content-blocks">
              {msg.content.map((block, index) => {
                if (block.type === "text") {
                  return <div key={index} className="message-text-block">{block.text}</div>;
                }
                if (block.type === "image_attachment") {
                  return (
                    <img
                      key={index}
                      src={getAttachmentUrl(block.attachmentId)}
                      alt={block.fileName || "图片"}
                      className="message-image-block"
                      loading="lazy"
                    />
                  );
                }
                if (block.type === "image_url") {
                  return (
                    <img
                      key={index}
                      src={block.image_url?.url || ""}
                      alt="图片"
                      className="message-image-block"
                      loading="lazy"
                    />
                  );
                }
                return null;
              })}
            </div>
          ) : (
            msg.text
          )}
        </div>
      )}
    </div>
  );
}, areRowPropsEqual);

const MessageList = forwardRef(({
  messages,
  graphBlocks = [],
  isLoading,
  adaptationDefinitions = [],
  adaptationButtonVisibility = null,
  bottomContent = null,
  focusedBlockSHA1 = "",
  hideWideScreenSideBranches = false,
  onActivateBlock,
  onBranchFromBlock,
  onRegenerate,
  onToggleAdaptation,
  onRunAdaptation,
  onReadBlockChange,
  scrollRequest,
  onScrollRequestHandled,
}, ref) => {
  const containerRef = useRef(null);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, msg: null });
  const { showToast } = useApp();
  const hasInitializedRef = useRef(false);
  const lastHandledScrollRequestIdRef = useRef(0);
  const visibleReadBlockSHA1sRef = useRef(new Set());
  const readBlockMarkerMapRef = useRef(new Map());
  const lastReportedReadBlockSHA1Ref = useRef("");
  const lastReportedScoreRef = useRef(null);
  const lastSwitchAtRef = useRef(0);
  const notifyRafRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const scrollDirectionRef = useRef("none");
  const prevScrollHeightRef = useRef(0);
  const userWasNearBottomRef = useRef(false);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.visible ? { visible: false, x: 0, y: 0, msg: null } : prev));
  }, []);

  const handleOpenContextMenu = useCallback((msg, x, y) => {
    setContextMenu({ visible: true, x, y, msg });
  }, []);

  const clearNotifyRaf = useCallback(() => {
    if (notifyRafRef.current) {
      window.cancelAnimationFrame(notifyRafRef.current);
      notifyRafRef.current = 0;
    }
  }, []);

  const notifyLatestReadBlock = useCallback(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const containerRect = element.getBoundingClientRect();
    const direction = scrollDirectionRef.current;
    const anchorY = getDirectionalAnchorY(containerRect, direction);
    const candidates = buildReadBlockCandidates(
      readBlockMarkerMapRef.current.values(),
      containerRect,
      anchorY,
    );

    if (candidates.length === 0) {
      return;
    }

    const anchorCandidates = candidates.filter((candidate) => candidate.intersectsAnchor);
    const pool = anchorCandidates.length > 0 ? anchorCandidates : candidates;
    pool.sort((left, right) => left.score - right.score);

    const bestCandidate = pool[0];

    if (!bestCandidate?.blockSHA1) {
      return;
    }

    const currentBlockSHA1 = lastReportedReadBlockSHA1Ref.current;
    const currentCandidate = currentBlockSHA1
      ? candidates.find((candidate) => candidate.blockSHA1 === currentBlockSHA1) ?? null
      : null;
    const currentScore =
      currentBlockSHA1 && currentBlockSHA1 !== bestCandidate.blockSHA1
        ? currentCandidate?.score ?? null
        : bestCandidate.score;
    const now = Date.now();
    const isSameBlock = bestCandidate.blockSHA1 === currentBlockSHA1;
    const hasRecentSwitch = now - lastSwitchAtRef.current < READ_SWITCH_MIN_INTERVAL_MS;

    if (!isSameBlock && hasRecentSwitch) {
      return;
    }

    const shouldForceSwitch =
      !currentCandidate ||
      currentCandidate.visibilityRatio < 0.16 ||
      (bestCandidate.intersectsAnchor && !currentCandidate.intersectsAnchor);

    if (!isSameBlock && currentScore !== null && !shouldForceSwitch) {
      const hasEnoughImprovement =
        bestCandidate.score <= currentScore - READ_SWITCH_HYSTERESIS;

      if (!hasEnoughImprovement) {
        return;
      }
    }

    if (isSameBlock) {
      lastReportedScoreRef.current = bestCandidate.score;
      return;
    }

    lastReportedReadBlockSHA1Ref.current = bestCandidate.blockSHA1;
    lastReportedScoreRef.current = bestCandidate.score;
    lastSwitchAtRef.current = now;
    onReadBlockChange?.(bestCandidate.blockSHA1);
  }, [onReadBlockChange]);

  const scheduleNotifyLatestReadBlock = useCallback(() => {
    if (notifyRafRef.current) {
      return;
    }

    notifyRafRef.current = window.requestAnimationFrame(() => {
      notifyRafRef.current = 0;
      notifyLatestReadBlock();
    });
  }, [notifyLatestReadBlock]);

  const scrollToBlock = useCallback(
    (blockSHA1, behavior = "auto") => {
      if (!blockSHA1) {
        return false;
      }

      const element = containerRef.current;

      if (!element) {
        return false;
      }

      const marker = element.querySelector(`[data-read-block-sha1="${blockSHA1}"]`);

      if (!marker) {
        return false;
      }

      // Scroll the message row instead of the tiny read marker to avoid half-visible focus blocks.
      const target = marker.closest(".message-row") ?? marker;

      if (!target) {
        return false;
      }

      target.scrollIntoView({
        behavior,
        block: "start",
      });

      scheduleNotifyLatestReadBlock();

      return true;
    },
    [scheduleNotifyLatestReadBlock],
  );

  const scrollToBottom = useCallback((behavior = "auto") => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });

    scheduleNotifyLatestReadBlock();
  }, [scheduleNotifyLatestReadBlock]);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return undefined;
    }

    visibleReadBlockSHA1sRef.current = new Set();
    readBlockMarkerMapRef.current = new Map();
    lastReportedReadBlockSHA1Ref.current = "";
    lastReportedScoreRef.current = null;
    lastSwitchAtRef.current = 0;
    lastScrollTopRef.current = element.scrollTop;
    scrollDirectionRef.current = "none";

    for (const marker of element.querySelectorAll(READ_MARKER_SELECTOR)) {
      const blockSHA1 = marker.getAttribute("data-read-block-sha1");

      if (blockSHA1) {
        readBlockMarkerMapRef.current.set(blockSHA1, marker);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const blockSHA1 = entry.target.getAttribute("data-read-block-sha1");

          if (!blockSHA1) {
            continue;
          }

          if (entry.isIntersecting) {
            visibleReadBlockSHA1sRef.current.add(blockSHA1);
          } else {
            visibleReadBlockSHA1sRef.current.delete(blockSHA1);
          }
        }

        scheduleNotifyLatestReadBlock();
      },
      {
        root: element,
        rootMargin: READ_MARKER_ROOT_MARGIN,
        threshold: 0,
      },
    );

    for (const marker of readBlockMarkerMapRef.current.values()) {
      observer.observe(marker);
    }

    scheduleNotifyLatestReadBlock();

    return () => {
      observer.disconnect();
      visibleReadBlockSHA1sRef.current.clear();
      readBlockMarkerMapRef.current.clear();
      clearNotifyRaf();
    };
  }, [clearNotifyRaf, messages, scheduleNotifyLatestReadBlock]);

  useEffect(() => {
    if (!scrollRequest?.id || lastHandledScrollRequestIdRef.current === scrollRequest.id) {
      return;
    }

    lastHandledScrollRequestIdRef.current = scrollRequest.id;
    if (scrollRequest.targetBlockSHA1 && scrollToBlock(scrollRequest.targetBlockSHA1, scrollRequest.behavior ?? "smooth")) {
      onScrollRequestHandled?.(scrollRequest.id);
      return;
    }
    scrollToBottom(scrollRequest.behavior ?? "auto");
    onScrollRequestHandled?.(scrollRequest.id);
  }, [scrollRequest, scrollToBlock]);

  const streamingScrollRafRef = useRef(0);

  useEffect(() => {
    if (!isLoading) {
      prevScrollHeightRef.current = 0;
      userWasNearBottomRef.current = true;
      return;
    }

    const element = containerRef.current;
    if (element) {
      userWasNearBottomRef.current = true;
      prevScrollHeightRef.current = element.scrollHeight;
      element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
    }

    function tick() {
      streamingScrollRafRef.current = requestAnimationFrame(() => {
        streamingScrollRafRef.current = 0;

        const element = containerRef.current;
        if (!element) {
          return;
        }

        const currentScrollHeight = element.scrollHeight;
        const currentScrollTop = element.scrollTop;
        const clientHeight = element.clientHeight;
        const distanceFromBottom = currentScrollHeight - currentScrollTop - clientHeight;

        if (prevScrollHeightRef.current > 0 && currentScrollHeight > prevScrollHeightRef.current) {
          if (userWasNearBottomRef.current) {
            element.scrollTo({
              top: element.scrollHeight,
              behavior: "auto",
            });
          }
        }

        prevScrollHeightRef.current = currentScrollHeight;
        userWasNearBottomRef.current = (element.scrollHeight - element.scrollTop - clientHeight) < 150;

        tick();
      });
    }

    tick();

    return () => {
      if (streamingScrollRafRef.current) {
        cancelAnimationFrame(streamingScrollRafRef.current);
        streamingScrollRafRef.current = 0;
      }
    };
  }, [isLoading]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const handleScroll = () => {
      const currentScrollTop = element.scrollTop;
      const currentScrollHeight = element.scrollHeight;
      const clientHeight = element.clientHeight;
      const distanceFromBottom = currentScrollHeight - currentScrollTop - clientHeight;

      if (currentScrollTop > lastScrollTopRef.current) {
        scrollDirectionRef.current = "down";
      } else if (currentScrollTop < lastScrollTopRef.current) {
        scrollDirectionRef.current = "up";
      }

      lastScrollTopRef.current = currentScrollTop;
      userWasNearBottomRef.current = distanceFromBottom < 150;
      scheduleNotifyLatestReadBlock();
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      element.removeEventListener("scroll", handleScroll);
    };
  }, [scheduleNotifyLatestReadBlock]);

  useImperativeHandle(ref, () => ({
    scrollToBottom,
    scrollToBlock,
    scrollToLatest: scrollToBottom,
  }));

  useLayoutEffect(() => {
    if (!containerRef.current || hasInitializedRef.current || messages.length === 0) {
      return;
    }

    hasInitializedRef.current = true;
    if (focusedBlockSHA1 && scrollToBlock(focusedBlockSHA1, "auto")) {
      return;
    }

    scrollToBottom("auto");
  }, [focusedBlockSHA1, messages.length, scrollToBlock]);

  const toolbarDefinitions = adaptationDefinitions.filter(
    (definition) => definition.ui?.placement === "message-toolbar",
  );
  const visibleToolbarDefinitions = toolbarDefinitions.filter((definition) => {
    if (adaptationButtonVisibility?.enabled === false) {
      return false;
    }

    const byKey = adaptationButtonVisibility?.byKey ?? {};

    if (Object.prototype.hasOwnProperty.call(byKey, definition.key)) {
      return byKey[definition.key] !== false;
    }

    return true;
  });
  const graphBlockMap = useMemo(
    () => new Map((graphBlocks ?? []).map((block) => [block.sha1, block])),
    [graphBlocks],
  );

  const contextMenuItems = useMemo(() => {
    const msg = contextMenu.msg;
    if (!msg) return [];

    const items = [];
    const branchInfo = msg.branchInfo;
    const adaptationInfo = msg.adaptationInfo;

    const selectedText = window.getSelection()?.toString();
    if (selectedText?.length > 0) {
      items.push({
        key: "copy-selection",
        label: "复制",
        onClick: () => {
          navigator.clipboard.writeText(selectedText).then(() => {
            showToast("已复制");
          });
        },
      });
    }

    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobileUA) {
      items.push({
        key: "select-copy",
        label: "选择复制",
        onClick: () => {
          const bodyEl = document.getElementById(`msg-body-${msg.id}`);
          if (bodyEl) {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(bodyEl);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        },
      });
      items.push({ key: "sep-mobile-copy", separator: true });
    }

    if (branchInfo) {
      items.push({
        key: "continue-from-here",
        label: "从这里继续",
        disabled: isLoading || branchInfo.isActiveBlock,
        onClick: () => onBranchFromBlock?.(msg.blockSHA1),
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
        onClick: () => onRegenerate?.(msg.blockSHA1),
      });
    }

    if (adaptationInfo && visibleToolbarDefinitions.length > 0) {
      if (items.length > 0) {
        items.push({ key: "sep-adapt", separator: true });
      }

      for (const definition of visibleToolbarDefinitions) {
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
            onClick: () => onRunAdaptation?.(msg.blockSHA1, definition.key),
          });
        } else {
          items.push({
            key: definition.key,
            label: definition.shortLabel,
            checked: isActive,
            disabled: isLoading,
            onClick: () => onToggleAdaptation?.(msg.blockSHA1, definition.key, !isActive),
          });
        }
      }
    }

    return items;
  }, [contextMenu.msg, isLoading, visibleToolbarDefinitions, onBranchFromBlock, onActivateBlock, onRegenerate, onToggleAdaptation, onRunAdaptation, showToast]);

  return (
    <div className="messages-container" ref={containerRef}>
      <div className="messages-content">
        {messages.map((msg) => (
          <MemoMessageRow
            key={msg.id}
            msg={msg}
            isFocused={Boolean(msg.blockSHA1 && msg.blockSHA1 === focusedBlockSHA1)}
            isLoading={isLoading}
            hideWideScreenSideBranches={hideWideScreenSideBranches}
            graphBlockMap={graphBlockMap}
            visibleToolbarDefinitions={visibleToolbarDefinitions}
            onActivateBlock={onActivateBlock}
            onBranchFromBlock={onBranchFromBlock}
            onRegenerate={onRegenerate}
            onToggleAdaptation={onToggleAdaptation}
            onRunAdaptation={onRunAdaptation}
            onContextMenu={handleOpenContextMenu}
          />
        ))}

        {isLoading && (
          <div className="message-row assistant">
            <div className="message-bubble">
              <span className="dot-typing">思考中...</span>
            </div>
          </div>
        )}

        {bottomContent}
        <ContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      </div>
    </div>
  );
});

export default MessageList;
