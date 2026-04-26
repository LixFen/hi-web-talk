import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { normalizeMarkdownMath } from "../lib/markdown";

const markdownRemarkPlugins = [remarkMath, remarkGfm];
const markdownRehypePlugins = [rehypeKatex, rehypeHighlight];

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

function buildCopyText(block) {
  if (block.blockType === "system") {
    return `System\n${block.prompt}`;
  }

  return `用户\n${block.prompt}\n\n助手\n${block.response}`;
}

function renderFlagSummary(block) {
  const activeFlags = Object.entries(block.flags ?? {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);

  return activeFlags.length > 0 ? activeFlags.join(" / ") : "无";
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
  const [copyState, setCopyState] = useState("idle");

  useEffect(() => {
    if (copyState !== "done") {
      return undefined;
    }

    const timerId = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timerId);
  }, [copyState]);

  const toolbarDefinitions = adaptationDefinitions.filter(
    (definition) => definition.ui?.placement === "message-toolbar",
  );
  const branchInfo = block.branchInfo ?? null;
  const adaptationInfo = block.adaptationInfo ?? null;
  const summaryInfo = block.summaryInfo ?? null;
  const isSystemBlock = block.blockType === "system";
  const normalizedBlockResponse = normalizeMarkdownMath(block.response || "暂无内容");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildCopyText(block));
      setCopyState("done");
    } catch {
      setCopyState("failed");
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
            {isSystemBlock ? "系统根块" : `对话块 ${block.sha1.slice(0, 8)}`}
          </h3>
        </div>
        <div className="block-card-header-meta">
          <span className="block-card-sha">{block.sha1.slice(0, 12)}</span>
          {block.graphInfo?.isActiveBlock ? (
            <span className="block-card-pill accent">当前活动块</span>
          ) : null}
          {isFocused ? <span className="block-card-pill focused">当前焦点</span> : null}
          {block.graphInfo?.isInActiveChain ? (
            <span className="block-card-pill">当前链</span>
          ) : null}
        </div>
      </div>

      <div className="block-card-body">
        <section className="block-card-section">
          <div className="block-card-section-title">用户</div>
          <div className="block-card-prompt">{block.prompt || "暂无内容"}</div>
        </section>

        {!isSystemBlock ? (
          <section className="block-card-section">
            <div className="block-card-section-title">AI 回复</div>
            <div className="markdown-body block-card-response">
              <ReactMarkdown
                remarkPlugins={markdownRemarkPlugins}
                rehypePlugins={markdownRehypePlugins}
              >
                {normalizedBlockResponse}
              </ReactMarkdown>
            </div>
          </section>
        ) : null}

        {summaryInfo?.status === "completed" && summaryInfo.summary ? (
          <section className="summary-panel block-card-summary">
            <div className="summary-panel-title">摘要</div>
            <div className="summary-panel-content">{summaryInfo.summary}</div>
          </section>
        ) : null}

        <div className="block-card-badges">
          <span className="block-card-pill">深度 {block.graphInfo?.depth ?? 0}</span>
          <span className="block-card-pill">子节点 {block.graphInfo?.childCount ?? 0}</span>
          {!isSystemBlock && branchInfo?.siblingCount > 1 ? (
            <span className="block-card-pill">
              分支 {branchInfo.siblingIndex}/{branchInfo.siblingCount}
            </span>
          ) : null}
          {!isSystemBlock && adaptationInfo?.contextIgnore ? (
            <span className="block-card-pill warning">忽略上下文</span>
          ) : null}
          {!isSystemBlock && adaptationInfo?.summaryPreferred ? (
            <span className="block-card-pill">优先摘要</span>
          ) : null}
          {!isSystemBlock && adaptationInfo?.summaryPinned ? (
            <span className="block-card-pill">固定摘要</span>
          ) : null}
          {!isSystemBlock && adaptationInfo?.labels?.map((label) => (
            <span key={label.key} className="block-card-pill accent-soft">
              {label.label}
            </span>
          ))}
          {summaryInfo?.status ? (
            <span className={`block-card-pill summary-${summaryInfo.status}`}>
              摘要 {summaryInfo.status}
            </span>
          ) : null}
        </div>

        <div className="block-card-actions">
          <button className="message-action-btn" type="button" onClick={handleCopy}>
            {copyState === "done" ? "已复制" : copyState === "failed" ? "复制失败" : "复制内容"}
          </button>
          {!block.graphInfo?.isActiveBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading}
              onClick={() => onActivateBlock?.(block.sha1)}
            >
              切到这里
            </button>
          ) : null}
          {onFocusBlock && !isFocused ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading}
              onClick={() => onFocusBlock?.(block.sha1)}
            >
              设为焦点
            </button>
          ) : null}
          {!isSystemBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading || branchInfo?.isActiveBlock}
              onClick={() => onBranchFromBlock?.(block.sha1)}
            >
              从这里继续
            </button>
          ) : null}
          {!isSystemBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading || !branchInfo?.previousBranchHeadSHA1}
              onClick={() => onActivateBlock?.(branchInfo?.previousBranchHeadSHA1)}
            >
              上一分支
            </button>
          ) : null}
          {!isSystemBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading || !branchInfo?.nextBranchHeadSHA1}
              onClick={() => onActivateBlock?.(branchInfo?.nextBranchHeadSHA1)}
            >
              下一分支
            </button>
          ) : null}
          {!isSystemBlock ? (
            <button
              className="message-action-btn"
              type="button"
              disabled={isLoading}
              onClick={() => onRegenerate?.(block.sha1)}
            >
              重新生成
            </button>
          ) : null}
          {!isSystemBlock && allowDangerousBlockDelete ? (
            <button
              className="message-action-btn danger"
              type="button"
              disabled={isLoading}
              onClick={() => onDeleteBlockTree?.(block.sha1)}
            >
              {"\u5220\u9664\u6b64\u5757\u53ca\u540e\u7ee7"}
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
                  {isCommand ? getCommandLabel(definition, adaptationInfo) : definition.shortLabel}
                </button>
              );
            })}
          </div>
        ) : null}

        <details className="block-card-details">
          <summary>SHA1 / Flags / 用量</summary>
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
              <p>{renderFlagSummary(block)}</p>
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
