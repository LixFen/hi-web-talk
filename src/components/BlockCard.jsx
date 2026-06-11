import { useEffect, useState } from "react";
import SafeMarkdown from "./SafeMarkdown";
import { useLocale } from "../contexts/LocaleContext";
import { extractPromptText, extractPromptAttachments } from "../lib/content";
import { getAttachmentUrl } from "../lib/chatApi";

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

function ReasoningPanel({ reasoning, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { t } = useLocale();

  if (!reasoning || reasoning.trim().length === 0) {
    return null;
  }

  return (
    <div className={`reasoning-panel ${isOpen ? 'open' : ''}`}>
      <button
        className="reasoning-panel-header"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <span className="reasoning-panel-title">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="reasoning-panel-icon"
          >
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          {t("block.reasoning")}
        </span>
        <ReasoningIcon isOpen={isOpen} />
      </button>
      <div className="reasoning-panel-content" aria-hidden={!isOpen}>
        <SafeMarkdown className="reasoning-markdown">
          {reasoning}
        </SafeMarkdown>
      </div>
    </div>
  );
}

function getCommandLabel(definition, adaptationInfo, t) {
  if (definition.key === "summary.generate") {
    const status = adaptationInfo?.summaryGenerationStatus ?? "idle";

    if (status === "pending") {
      return t("summary.generating");
    }

    if (status === "completed") {
      return t("summary.refresh");
    }

    if (status === "failed") {
      return t("summary.retry");
    }
  }

  return definition.shortLabel;
}

function buildCopyText(block) {
  if (block.blockType === "system") {
    return `System\n${extractPromptText(block.prompt)}`;
  }

  return `${t("msg.user")}\n${extractPromptText(block.prompt)}\n\n${t("msg.ai")}\n${block.response}`;
}

function buildRawText(block) {
  if (block.blockType === "system") {
    return extractPromptText(block.prompt) || "";
  }

  const parts = [];

  if (block.prompt) {
    parts.push(extractPromptText(block.prompt));
  }

  if (block.reasoning) {
    parts.push(block.reasoning);
  }

  if (block.response) {
    parts.push(block.response);
  }

  return parts.join("\n\n");
}

function renderFlagSummary(block, t) {
  const activeFlags = Object.entries(block.flags ?? {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);

  return activeFlags.length > 0 ? activeFlags.join(" / ") : t("msg.noFlags");
}

export default function BlockCard({
  block,
  isLoading,
  adaptationDefinitions = [],
  onActivateBlock,
  onFocusBlock,
  onBranchFromBlock,
  onRegenerate,
  onDeleteBlockTree,
  allowDangerousBlockDelete = false,
  onToggleAdaptation,
  onRunAdaptation,
  className = "",
  isFocused = false,
}) {
  const { t } = useLocale();
  const [copyState, setCopyState] = useState("idle");
  const [rawCopyState, setRawCopyState] = useState("idle");

  useEffect(() => {
    if (copyState !== "done") {
      return undefined;
    }

    const timerId = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timerId);
  }, [copyState]);

  useEffect(() => {
    if (rawCopyState !== "done") {
      return undefined;
    }

    const timerId = window.setTimeout(() => setRawCopyState("idle"), 1600);
    return () => window.clearTimeout(timerId);
  }, [rawCopyState]);

  const toolbarDefinitions = adaptationDefinitions.filter(
    (definition) => definition.ui?.placement === "message-toolbar",
  );
  const branchInfo = block.branchInfo ?? null;
  const adaptationInfo = block.adaptationInfo ?? null;
  const summaryInfo = block.summaryInfo ?? null;
  const isSystemBlock = block.blockType === "system";
  const attachments = extractPromptAttachments(block.prompt);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildCopyText(block));
      setCopyState("done");
    } catch {
      setCopyState("failed");
    }
  }

  async function handleCopyRaw() {
    try {
      await navigator.clipboard.writeText(buildRawText(block));
      setRawCopyState("done");
    } catch {
      setRawCopyState("failed");
    }
  }

  return (
    <article
      className={`block-card ${isFocused ? "focused" : ""} ${className}`.trim()}
      data-block-sha1={block.sha1}
      data-focused-block-sha1={isFocused ? block.sha1 : ""}
    >
      <div className="block-card-header">
        <div>
          <div className="block-card-eyebrow">
            {isSystemBlock ? "SYSTEM ROOT" : block.modelAlias || "dialogue"}
          </div>
          <h3 className="block-card-title">
            {isSystemBlock ? t("block.systemRoot") : `${t("block.conversationBlock")} ${block.sha1.slice(0, 8)}`}
          </h3>
        </div>
        <div className="block-card-header-meta">
          <span className="block-card-sha">{block.sha1.slice(0, 12)}</span>
          {block.graphInfo?.isActiveBlock ? (
            <span className="block-card-pill accent">{t("block.activeBlock")}</span>
          ) : null}
          {isFocused ? <span className="block-card-pill focused">{t("block.focusedBlock")}</span> : null}
          {block.graphInfo?.isInActiveChain ? (
            <span className="block-card-pill">{t("block.currentChain")}</span>
          ) : null}
        </div>
      </div>

      <div className="block-card-body">
        <section className="block-card-section">
          <div className="block-card-section-title">{t("block.user")}</div>
          <div className="block-card-prompt">{extractPromptText(block.prompt) || t("common.noContent")}</div>
        </section>

        {attachments.length > 0 ? (
          <details className="block-card-details">
            <summary>
              {t("block.attachments", { count: attachments.length })}
            </summary>
            <div className="block-card-attachments">
              {attachments.map((att) => (
                <img
                  key={att.attachmentId}
                  className="block-card-attachment-thumb"
                  src={getAttachmentUrl(att.attachmentId)}
                  alt={att.fileName || t("common.image")}
                  loading="lazy"
                />
              ))}
            </div>
          </details>
        ) : null}

        {!isSystemBlock && block.reasoning ? (
          <section className="block-card-section">
            <div className="block-card-section-title">{t("block.reasoning")}</div>
            <ReasoningPanel reasoning={block.reasoning} />
          </section>
        ) : null}

        {!isSystemBlock ? (
          <section className="block-card-section">
            <div className="block-card-section-title">{t("block.aiResponse")}</div>
            <SafeMarkdown className="block-card-response">
              {block.response || t("common.noContent")}
            </SafeMarkdown>
          </section>
        ) : null}

        {summaryInfo?.status === "completed" && summaryInfo.summary ? (
          <section className="summary-panel block-card-summary">
            <div className="summary-panel-title">{t("block.summary")}</div>
            <div className="summary-panel-content">{summaryInfo.summary}</div>
          </section>
        ) : null}

        <div className="block-card-badges">
          <span className="block-card-pill">{t("msg.depth", { count: block.graphInfo?.depth ?? 0 })}</span>
          <span className="block-card-pill">{t("msg.childCount", { count: block.graphInfo?.childCount ?? 0 })}</span>
          {!isSystemBlock && branchInfo?.siblingCount > 1 ? (
            <span className="block-card-pill">
              {t("msg.branchInfo", { index: branchInfo.siblingIndex, total: branchInfo.siblingCount })}
            </span>
          ) : null}
          {!isSystemBlock && adaptationInfo?.contextIgnore ? (
            <span className="block-card-pill warning">{t("msg.ignoreContext")}</span>
          ) : null}
          {!isSystemBlock && adaptationInfo?.summaryPreferred ? (
            <span className="block-card-pill">{t("msg.preferSummary")}</span>
          ) : null}
          {!isSystemBlock && adaptationInfo?.summaryPinned ? (
            <span className="block-card-pill">{t("msg.pinSummary")}</span>
          ) : null}
          {!isSystemBlock && adaptationInfo?.labels?.map((label) => (
            <span key={label.key} className="block-card-pill accent-soft">
              {label.label}
            </span>
          ))}
          {summaryInfo?.status ? (
            <span className={`block-card-pill summary-${summaryInfo.status}`}>
              {t("msg.summaryStatus", { status: summaryInfo.status })}
            </span>
          ) : null}
        </div>

        <div className="block-card-actions">
          <button className="message-action-btn" type="button" onClick={handleCopy}>
            {copyState === "done" ? t("common.copied") : copyState === "failed" ? t("common.copyFailed") : t("common.copyContent")}
          </button>
          <button className="message-action-btn" type="button" onClick={handleCopyRaw}>
            {rawCopyState === "done"
              ? t("common.copied")
              : rawCopyState === "failed"
                ? t("common.copyFailed")
                : t("common.copyRaw")}
          </button>
          {!block.graphInfo?.isActiveBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading}
              onClick={() => onActivateBlock?.(block.sha1)}
            >
              {t("block.switchTo")}
            </button>
          ) : null}
          {onFocusBlock && !isFocused ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading}
              onClick={() => onFocusBlock?.(block.sha1)}
            >
              {t("block.setFocus")}
            </button>
          ) : null}
          {!isSystemBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading || branchInfo?.isActiveBlock}
              onClick={() => onBranchFromBlock?.(block.sha1)}
            >
              {t("msg.continueFromHere")}
            </button>
          ) : null}
          {!isSystemBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading || !branchInfo?.previousBranchHeadSHA1}
              onClick={() => onActivateBlock?.(branchInfo?.previousBranchHeadSHA1)}
            >
              {t("msg.previousBranch")}
            </button>
          ) : null}
          {!isSystemBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading || !branchInfo?.nextBranchHeadSHA1}
              onClick={() => onActivateBlock?.(branchInfo?.nextBranchHeadSHA1)}
            >
              {t("msg.nextBranch")}
            </button>
          ) : null}
          {!isSystemBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading}
              onClick={() => onRegenerate?.(block.sha1)}
            >
              {t("msg.regenerate")}
            </button>
          ) : null}
          {!isSystemBlock && allowDangerousBlockDelete ? (
            <button
              className="message-action-btn danger"
              type="button"
              disabled={isLoading}
              onClick={() => onDeleteBlockTree?.(block.sha1)}
            >
              {t("block.deleteBlockTree")}
            </button>
          ) : null}
        </div>

        {!isSystemBlock && adaptationInfo ? (
          <div className="block-card-actions block-card-actions-wrap">
            {toolbarDefinitions.map((definition) => {
              const currentRecord = adaptationInfo.byKey?.[definition.key];
              const isActive = Boolean(currentRecord?.enabled);
              const isCommand = definition.kind === "command";
              const isPendingCommand =
                definition.key === "summary.generate" &&
                adaptationInfo.summaryGenerationStatus === "pending";

              return (
                <button
                  key={definition.key}
                  className={`message-action-btn adaptation-action-btn ${isActive ? "selected" : ""}`}
                  type="button"
                  disabled={isLoading || isPendingCommand}
                  onClick={() =>
                    isCommand
                      ? onRunAdaptation?.(block.sha1, definition.key)
                      : onToggleAdaptation?.(block.sha1, definition.key, !isActive)
                  }
                >
                  {isCommand ? getCommandLabel(definition, adaptationInfo, t) : definition.shortLabel}
                </button>
              );
            })}
          </div>
        ) : null}

        <details className="block-card-details">
          <summary>{t("block.detailsSummary")}</summary>
          <div className="block-card-detail-grid">
            <div>
              <strong>SHA1</strong>
              <p>{block.sha1}</p>
            </div>
            <div>
              <strong>Parent</strong>
              <p>{block.parentBlockSHA1 || "ROOT"}</p>
            </div>
            <div>
              <strong>Flags</strong>
              <p>{renderFlagSummary(block, t)}</p>
            </div>
            <div>
              <strong>Token</strong>
              <p>
                in {block.tokenUsage?.input ?? 0} / out {block.tokenUsage?.output ?? 0} / total {block.tokenUsage?.total ?? 0}
              </p>
            </div>
          </div>
        </details>

        <details className="block-card-details">
          <summary>Meta</summary>
          <pre className="block-card-meta">{JSON.stringify(block.meta ?? {}, null, 2)}</pre>
        </details>
      </div>
    </article>
  );
}
