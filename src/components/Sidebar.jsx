import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useSession } from "../contexts/SessionContext";
import ContextMenu from "./ContextMenu";

const Sidebar = ({
  isCollapsed,
  onToggleCollapse,
  onOpenSettings,
  className = "",
  showHeaderToggle = true,
  toggleVariant = "collapse",
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}) => {
  const { currentUser, logout } = useAuth();
  const {
    sessionSummaries,
    activeConversation,
    startNewChatDraft,
    deleteConversation,
    renameConversation,
    regenerateTitle,
  } = useSession();
  const navigate = useNavigate();

  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    conversation: null,
  });

  const conversations = useMemo(
    () =>
      sessionSummaries.map((session) => ({
        id: session.sessionHash,
        title: session.title,
      })),
    [sessionSummaries],
  );

  const activeConversationId = activeConversation?.sessionHash;

  const handleNewChat = () => {
    if (toggleVariant === "close") {
      onToggleCollapse?.();
    }
    startNewChatDraft();
    navigate("/");
  };

  const handleSelectConversation = (sessionHash) => {
    if (toggleVariant === "close") {
      onToggleCollapse?.();
    }
    navigate(`/chat/${sessionHash}`);
  };

  const handleDeleteConversation = async (conversation) => {
    const result = await deleteConversation(conversation);
    if (result && conversation.id === activeConversationId) {
      if (result.nextHash) {
        navigate(`/chat/${result.nextHash}`);
      } else {
        navigate("/");
      }
    }
  };

  const handleRenameClick = async (conversation) => {
    const nextTitle = window.prompt(
      "请输入新的会话名称",
      conversation.title || "",
    );
    if (nextTitle === null) return;
    try {
      await renameConversation(conversation, nextTitle);
    } catch {
      // The parent already handles the user-facing error state.
    }
  };

  const handleContextMenu = (event, conversation) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      conversation,
    });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const buildContextMenuItems = () => {
    const conversation = contextMenu.conversation;
    if (!conversation) return [];
    return [
      {
        key: "regenerate-title",
        label: "重新生成标题",
        onClick: () => {
          const confirmed = window.confirm(
            "是否根据当前活动块链来生成标题？",
          );
          if (confirmed) {
            regenerateTitle(conversation, "default", true);
          }
        },
      },
      {
        key: "regenerate-title-important",
        label: "根据重要程度生成标题",
        onClick: () => {
          const confirmed = window.confirm(
            "是否根据已标记的重要内容来生成标题？",
          );
          if (confirmed) {
            regenerateTitle(conversation, "important", true);
          }
        },
      },
    ];
  };

  const toggleAriaLabel =
    toggleVariant === "close"
      ? "关闭会话列表"
      : isCollapsed
        ? "展开会话列表"
        : "收起会话列表";

  return (
    <div
      className={`sidebar ${isCollapsed ? "collapsed" : ""} ${className}`.trim()}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="sidebar-header">
        {!isCollapsed ? (
          <div className="sidebar-project-title">hi web talk</div>
        ) : null}
        {showHeaderToggle ? (
          <button
            className="sidebar-toggle-btn"
            type="button"
            onClick={onToggleCollapse}
            aria-label={toggleAriaLabel}
            title={toggleAriaLabel}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              {toggleVariant === "close" ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 6l12 12M18 6 6 18"
                />
              ) : isCollapsed ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m9 5 7 7-7 7"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m15 5-7 7 7 7"
                />
              )}
            </svg>
          </button>
        ) : null}
      </div>

      <button className="new-chat-btn" type="button" onClick={handleNewChat}>
        <svg
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          width="18"
          height="18"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        {!isCollapsed ? "开启新对话" : null}
      </button>

      {!isCollapsed ? (
        <div className="history-list">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`history-item-row ${conversation.id === activeConversationId ? "active" : ""}`}
              onContextMenu={(event) =>
                handleContextMenu(event, conversation)
              }
            >
              <button
                className={`history-item ${conversation.id === activeConversationId ? "active" : ""}`}
                type="button"
                onClick={() => handleSelectConversation(conversation.id)}
              >
                {conversation.title}
              </button>
              <button
                className="history-rename-btn"
                type="button"
                aria-label={`重命名会话 ${conversation.title}`}
                title="重命名会话"
                onClick={(event) => {
                  event.stopPropagation();
                  handleRenameClick(conversation);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.862 3.487a2.1 2.1 0 0 1 2.97 2.97L8.5 17.788l-3.75.75.75-3.75L16.862 3.487Z"
                  />
                </svg>
              </button>
              <button
                className="history-delete-btn"
                type="button"
                aria-label={`删除会话 ${conversation.title}`}
                title="删除会话"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteConversation(conversation);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 3h6m-9 4h12m-1 0-.867 12.142A2 2 0 0 1 14.138 21H9.862a2 2 0 0 1-1.995-1.858L7 7m3 4v6m4-6v6"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {!isCollapsed && currentUser ? (
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {currentUser.username?.charAt(0)?.toUpperCase?.() ?? "?"}
          </div>
          <div className="sidebar-user-name">{currentUser.username}</div>
          {currentUser.role === "admin" ? (
            <span className="sidebar-admin-badge">admin</span>
          ) : null}
          <button
            className="sidebar-logout-btn"
            type="button"
            onClick={logout}
            aria-label="退出登录"
            title="退出登录"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1"
              />
            </svg>
          </button>
        </div>
      ) : null}

      <div className="sidebar-footer">
        <button
          className="sidebar-settings-btn"
          type="button"
          onClick={onOpenSettings}
          aria-label="打开设置"
          title="设置"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9l-.33-1.82-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {!isCollapsed ? "设置" : null}
        </button>
      </div>

      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        visible={contextMenu.visible}
        items={buildContextMenuItems()}
        onClose={closeContextMenu}
      />
    </div>
  );
};

export default Sidebar;
