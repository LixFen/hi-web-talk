import { useCallback, useEffect, useState } from "react";
import { getSession } from "../../lib/chatApi";
import ChatView from "../ChatView";
import GraphView from "../GraphView";

// Read-only preview: all interaction callbacks are no-ops.
const noop = () => {};

export default function PreviewModal({ session, onClose }) {
  const [viewMode, setViewMode] = useState("chat"); // "chat" or "graph"
  const [sessionDetail, setSessionDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load session detail
  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const detail = await getSession(session.sessionHash);
        if (!cancelled) {
          setSessionDetail(detail);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "加载 session 失败");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadSession();

    return () => {
      cancelled = true;
    };
  }, [session.sessionHash]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Toggle view mode
  const handleToggleView = useCallback(() => {
    setViewMode((prev) => (prev === "chat" ? "graph" : "chat"));
  }, []);

  const graph = sessionDetail?.graph || null;

  return (
    <div className="preview-modal-backdrop" onClick={handleBackdropClick}>
      <div className="preview-modal">
        {/* Header */}
        <div className="preview-header">
          <div className="preview-title-group">
            <h2 className="preview-title">{session.title || "未命名会话"}</h2>
            <span className="preview-hash">{session.sessionHash}</span>
          </div>

          <div className="preview-actions">
            <button
              className="preview-view-toggle"
              onClick={handleToggleView}
              title={viewMode === "chat" ? "切换到网状图" : "切换到聊天视图"}
            >
              {viewMode === "chat" ? (
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="2" x2="12" y2="5" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="5" y2="12" />
                  <line x1="19" y1="12" x2="22" y2="12" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              )}
              <span>{viewMode === "chat" ? "网状图" : "聊天"}</span>
            </button>

            <button
              className="preview-close-btn"
              onClick={onClose}
              title="关闭"
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="preview-content">
          {isLoading ? (
            <div className="preview-loading">
              <div className="preview-loading-spinner" />
              <p>加载中...</p>
            </div>
          ) : error ? (
            <div className="preview-error">
              <p>{error}</p>
            </div>
          ) : (
            <div className="preview-scroll-content preview-readonly">
              {viewMode === "chat" ? (
                <ChatView
                  graphBlocks={graph?.blocks || []}
                  activeBlockSHA1={graph?.activeBlockSHA1 || ""}
                  focusedBlockSHA1={sessionDetail?.focusedBlockSHA1 || ""}
                  messages={sessionDetail?.messages || []}
                  isReplyPending={false}
                  bottomDockMode="hidden"
                  hideChatBottomDock
                  adaptationDefinitions={[]}
                  isLoading={false}
                  onActivateBlock={noop}
                  onFocusBlock={noop}
                  onBranchFromBlock={noop}
                  onRegenerate={noop}
                  onToggleAdaptation={noop}
                  onRunAdaptation={noop}
                  onScrollRequestHandled={noop}
                />
              ) : (
                <GraphView
                  blocks={graph?.blocks || []}
                  graph={graph}
                  focusedBlockSHA1={sessionDetail?.focusedBlockSHA1 || ""}
                  isLoading={false}
                  adaptationDefinitions={[]}
                  onActivateBlock={noop}
                  onFocusBlock={noop}
                  onBranchFromBlock={noop}
                  onRegenerate={noop}
                  onToggleAdaptation={noop}
                  onRunAdaptation={noop}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="preview-footer">
          <div className="preview-meta">
            {session.createdAt && (
              <span>创建: {new Date(session.createdAt).toLocaleString("zh-CN")}</span>
            )}
            {session.updatedAt && (
              <span>更新: {new Date(session.updatedAt).toLocaleString("zh-CN")}</span>
            )}
          </div>
          <div className="preview-hint">
            只读模式 - 在聊天页面中继续对话
          </div>
        </div>
      </div>
    </div>
  );
}
