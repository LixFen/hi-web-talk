import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkStation } from "../../contexts/WorkStationContext";
import { listAllLabels } from "../../lib/workstationApi";

const ARROW_TYPES = [
  { value: "none",         label: "无箭头", icon: "M5 12h14" },
  { value: "forward",      label: "正向 →", icon: "M5 12h14 M12 5l7 7-7 7" },
  { value: "reverse",      label: "反向 ←", icon: "M19 12H5 M12 19l-7-7 7-7" },
  { value: "bidirectional", label: "双向 ↔", icon: "M5 12h14 M12 5l7 7-7 7 M12 19l-7-7 7-7" },
];

export default function WorkstationContextMenu({
  x,
  y,
  type, // "canvas", "group", "session", "ungrouped", "connection"
  groupId,
  groupName,
  sessionHash,
  sessionTitle,
  isDeleted,
  connectionId,
  label: connLabel,
  annotation: connAnnotation,
  arrowType: connArrowType,
  onStartRename,
  onDelete,
  onToggleCollapse,
  onStartConnection,
  onRemoveFromGroup,
  onCleanupDeleted,
  onOpenBatchImport,
  onClose,
}) {
  const { createGroup, getSessionGroups, updateConnection } = useWorkStation();
  const menuRef = useRef(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [sessionGroups, setSessionGroups] = useState([]);
  const [showGroupsList, setShowGroupsList] = useState(false);

  // Connection editing state
  const [editLabel, setEditLabel] = useState(connLabel || "");
  const [editAnnotation, setEditAnnotation] = useState(connAnnotation || "");
  const [editArrowType, setEditArrowType] = useState(connArrowType || "forward");
  const [labelSuggestions, setLabelSuggestions] = useState([]);
  const [showLabelSuggestions, setShowLabelSuggestions] = useState(false);

  // Load session groups
  useEffect(() => {
    if (type === "session" && sessionHash) {
      getSessionGroups(sessionHash).then((groups) => {
        setSessionGroups(groups);
      });
    }
  }, [type, sessionHash, getSessionGroups]);

  // Load label suggestions for autocomplete
  useEffect(() => {
    if (type === "connection") {
      listAllLabels().then((result) => setLabelSuggestions(result.labels || [])).catch(() => {});
    }
  }, [type]);

  // Position menu within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 8;
      }
      if (y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 8;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [x, y]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Handle create group
  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (name) {
      await createGroup(name);
      setIsCreatingGroup(false);
      setNewGroupName("");
      onClose();
    }
  }, [newGroupName, createGroup, onClose]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        handleCreateGroup();
      } else if (e.key === "Escape") {
        setIsCreatingGroup(false);
        setNewGroupName("");
      }
    },
    [handleCreateGroup]
  );

  // Connection handlers
  // Fire-and-forget on blur: the promise may be orphaned when onClose unmounts us,
  // but the fetch still completes in the background.
  const handleSaveLabel = useCallback(() => {
    const trimmed = editLabel.trim();
    updateConnection(connectionId, { label: trimmed });
    setShowLabelSuggestions(false);
  }, [editLabel, connectionId, updateConnection]);

  const handleSaveAnnotation = useCallback(() => {
    const trimmed = editAnnotation.trim().slice(0, 15);
    updateConnection(connectionId, { annotation: trimmed });
  }, [editAnnotation, connectionId, updateConnection]);

  const handleChangeArrowType = useCallback(async (newType) => {
    await updateConnection(connectionId, { arrowType: newType });
    setEditArrowType(newType);
  }, [connectionId, updateConnection]);

  const handleDeleteConnection = useCallback(async () => {
    await onDelete?.();
    onClose();
  }, [onDelete, onClose]);

  // Filtered label suggestions (prefix match)
  const filteredSuggestions = editLabel.trim()
    ? labelSuggestions.filter((l) => l.toLowerCase().startsWith(editLabel.trim().toLowerCase()) && l !== editLabel.trim())
    : [];

  // Render menu items based on type
  const renderMenuItems = () => {
    switch (type) {
      case "connection":
        return (
          <>
            {/* Set label */}
            <div className="context-menu-section-label">标签</div>
            <div className="context-menu-input-row">
              <input
                autoFocus
                placeholder="输入标签..."
                value={editLabel}
                onChange={(e) => { setEditLabel(e.target.value); setShowLabelSuggestions(true); }}
                onKeyDown={(e) => { if (e.key === "Enter") { handleSaveLabel(); onClose(); } }}
                onBlur={handleSaveLabel}
                maxLength={20}
              />
              {showLabelSuggestions && filteredSuggestions.length > 0 && (
                <div className="context-menu-suggestions">
                  {filteredSuggestions.slice(0, 6).map((s) => (
                    <button
                      key={s}
                      className="context-menu-suggestion-item"
                      onMouseDown={(e) => { e.preventDefault(); setEditLabel(s); setShowLabelSuggestions(false); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Set annotation */}
            <div className="context-menu-section-label">字注</div>
            <div className="context-menu-input-row">
              <input
                placeholder="显示在线条上的文字"
                value={editAnnotation}
                onChange={(e) => setEditAnnotation(e.target.value.slice(0, 15))}
                onKeyDown={(e) => { if (e.key === "Enter") { handleSaveAnnotation(); onClose(); } }}
                onBlur={handleSaveAnnotation}
                maxLength={15}
              />
              <span className="context-menu-char-count">{editAnnotation.length}/15</span>
            </div>

            {/* Set arrow type */}
            <div className="context-menu-section-label">箭头</div>
            <div className="context-menu-arrow-grid">
              {ARROW_TYPES.map((at) => (
                <button
                  key={at.value}
                  className={`context-menu-arrow-btn ${editArrowType === at.value ? "active" : ""}`}
                  onClick={() => handleChangeArrowType(at.value)}
                  title={at.label}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points={at.icon} />
                  </svg>
                </button>
              ))}
            </div>

            <div className="context-menu-divider" />
            <button className="context-menu-item danger" onClick={handleDeleteConnection}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              删除连线
            </button>
          </>
        );

      case "canvas":
        return (
          <>
            {isCreatingGroup ? (
              <div className="context-menu-input">
                <input
                  autoFocus
                  placeholder="分组名称"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => {
                    if (!newGroupName.trim()) {
                      setIsCreatingGroup(false);
                    }
                  }}
                  maxLength={50}
                />
                <button onClick={handleCreateGroup} disabled={!newGroupName.trim()}>
                  创建
                </button>
              </div>
            ) : (
              <button
                className="context-menu-item"
                onClick={() => setIsCreatingGroup(true)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                创建新分组
              </button>
            )}
          </>
        );

      case "group":
        return (
          <>
            <button className="context-menu-item" onClick={() => { onStartRename?.(); onClose(); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              重命名
            </button>
            <button className="context-menu-item" onClick={() => { onToggleCollapse?.(); onClose(); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
              折叠/展开
            </button>
            <button className="context-menu-item" onClick={() => { onOpenBatchImport?.(groupId); onClose(); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              导入 session
            </button>
            <div className="context-menu-divider" />
            <button className="context-menu-item danger" onClick={() => { onDelete?.(); onClose(); }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              删除分组
            </button>
          </>
        );

      case "session":
        return (
          <>
            {isDeleted ? (
              <button className="context-menu-item danger" onClick={() => { onCleanupDeleted?.(); onClose(); }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                确认移除
              </button>
            ) : (
              <>
                <button className="context-menu-item" onClick={() => { onStartConnection?.(sessionHash); onClose(); }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  连接到...
                </button>

                {sessionGroups.length > 0 && (
                  <>
                    <button
                      className="context-menu-item"
                      onClick={() => setShowGroupsList(!showGroupsList)}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="9" y1="21" x2="9" y2="9" />
                      </svg>
                      查看所属分组 ({sessionGroups.length})
                    </button>

                    {showGroupsList && (
                      <div className="context-menu-sub">
                        {sessionGroups.map((g) => (
                          <div key={g.id} className="context-menu-item disabled">
                            {g.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {groupId && (
                  <>
                    <div className="context-menu-divider" />
                    <button className="context-menu-item" onClick={() => { onRemoveFromGroup?.(); onClose(); }}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                      从分组移除
                    </button>
                  </>
                )}
              </>
            )}
          </>
        );

      case "ungrouped":
        return (
          <div className="context-menu-item disabled">
            未分组区域
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      ref={menuRef}
      className="workstation-context-menu"
      style={{ left: x, top: y }}
    >
      {renderMenuItems()}
    </div>
  );
}
