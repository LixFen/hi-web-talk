import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkStation } from "../../contexts/WorkStationContext";
import { listSessions } from "../../lib/chatApi";
import { CARD_W, CARD_H, CARD_GAP, findFreeSpot } from "./GroupColumn";

export default function BatchImportModal({ groupId, onClose }) {
  const { addSessionToGroup, updateSessionPosition, groups, groupSessions } = useWorkStation();

  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all"); // "all", "today", "week", "month"
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);

  // Get target group name
  const targetGroup = useMemo(
    () => groups.find((g) => g.id === groupId),
    [groups, groupId]
  );

  // Sessions already in this group — shown as checked & disabled
  const existingHashes = useMemo(
    () => new Set((groupSessions[groupId] || []).map((s) => s.sessionHash)),
    [groupSessions, groupId]
  );

  // Load all sessions
  useEffect(() => {
    let cancelled = false;

    const loadSessions = async () => {
      setIsLoading(true);
      try {
        const pageSize = 100;
        let page = 1;
        let allSessions = [];
        let total = 0;

        while (true) {
          const result = await listSessions(page, pageSize);
          const pageSessions = result.sessions || [];
          allSessions = allSessions.concat(pageSessions);
          total = result.pagination?.total || allSessions.length;

          if (pageSessions.length === 0 || allSessions.length >= total) {
            break;
          }
          page++;
        }

        if (!cancelled) {
          setSessions(allSessions);
        }
      } catch (err) {
        console.error("Load sessions error:", err);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadSessions();

    return () => {
      cancelled = true;
    };
  }, []);

  // Filter sessions
  const filteredSessions = useMemo(() => {
    let filtered = sessions;

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          (s.title || "").toLowerCase().includes(query) ||
          s.sessionHash.toLowerCase().includes(query)
      );
    }

    // Date filter
    if (dateFilter !== "all") {
      const now = new Date();
      let cutoff;

      switch (dateFilter) {
        case "today":
          cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "week":
          cutoff = new Date(now);
          cutoff.setDate(cutoff.getDate() - 7);
          break;
        case "month":
          cutoff = new Date(now);
          cutoff.setMonth(cutoff.getMonth() - 1);
          break;
        default:
          cutoff = null;
      }

      if (cutoff) {
        filtered = filtered.filter(
          (s) => new Date(s.updatedAt) >= cutoff
        );
      }
    }

    return filtered;
  }, [sessions, searchQuery, dateFilter]);

  // Handle select/deselect
  const handleToggleSelect = useCallback((sessionHash) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionHash)) {
        next.delete(sessionHash);
      } else {
        next.add(sessionHash);
      }
      return next;
    });
  }, []);

  // Sessions available to select (excludes those already in the group)
  const selectableSessions = useMemo(
    () => filteredSessions.filter((s) => !existingHashes.has(s.sessionHash)),
    [filteredSessions, existingHashes]
  );

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(selectableSessions.map((s) => s.sessionHash)));
  }, [selectableSessions]);

  const handleDeselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  // Handle import
  const handleImport = useCallback(async () => {
    if (selected.size === 0) return;

    setIsImporting(true);
    try {
      const hashes = Array.from(selected);
      await Promise.all(hashes.map((sessionHash) => addSessionToGroup(sessionHash, groupId)));

      if (targetGroup?.viewMode === "area") {
        const existing = (groupSessions[groupId] || [])
          .filter((s) => s.posX != null && s.posY != null)
          .map((s) => ({ x: s.posX, y: s.posY, w: s.width || CARD_W, h: s.height || CARD_H }));

        for (const sessionHash of hashes) {
          const spot = findFreeSpot(0, existing.length ? 0 : 0, CARD_W, CARD_H, existing);
          await updateSessionPosition(sessionHash, groupId, {
            posX: spot.x,
            posY: spot.y,
            width: CARD_W,
            height: CARD_H,
          });
          existing.push({ x: spot.x, y: spot.y, w: CARD_W, h: CARD_H });
        }
      }

      onClose();
    } catch (err) {
      console.error("Import error:", err);
    } finally {
      setIsImporting(false);
    }
  }, [selected, groupId, targetGroup, groupSessions, addSessionToGroup, updateSessionPosition, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="batch-import-backdrop" onClick={handleBackdropClick}>
      <div className="batch-import-modal">
        {/* Header */}
        <div className="batch-import-header">
          <h2>导入 Session 到 {targetGroup?.name || "分组"}</h2>
          <button className="batch-import-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="batch-import-filters">
          <div className="filter-search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="搜索 session 标题..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-date">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            >
              <option value="all">全部时间</option>
              <option value="today">今天</option>
              <option value="week">最近一周</option>
              <option value="month">最近一月</option>
            </select>
          </div>
        </div>

        {/* Select actions */}
        <div className="batch-import-actions">
          <button onClick={handleSelectAll} disabled={selectableSessions.length === 0}>
            全选 ({selectableSessions.length})
          </button>
          <button onClick={handleDeselectAll} disabled={selected.size === 0}>
            取消全选
          </button>
          <span className="selected-count">
            已选择 {selected.size} 个
          </span>
        </div>

        {/* Session list */}
        <div className="batch-import-list">
          {isLoading ? (
            <div className="batch-import-loading">
              <div className="loading-spinner" />
              <p>加载中...</p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="batch-import-empty">
              <p>没有找到匹配的 session</p>
            </div>
          ) : (
            filteredSessions.map((session) => {
              const alreadyIn = existingHashes.has(session.sessionHash);
              return (
                <label
                  key={session.sessionHash}
                  className={`batch-import-item ${selected.has(session.sessionHash) ? "selected" : ""} ${alreadyIn ? "already-in" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={alreadyIn || selected.has(session.sessionHash)}
                    disabled={alreadyIn}
                    onChange={() => handleToggleSelect(session.sessionHash)}
                  />
                  <div className="item-info">
                    <span className="item-title">{session.title || "未命名会话"}</span>
                    <span className="item-date">{formatDate(session.updatedAt)}</span>
                  </div>
                  {alreadyIn && <span className="item-badge">已在组内</span>}
                </label>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="batch-import-footer">
          <button className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={handleImport}
            disabled={selected.size === 0 || isImporting}
          >
            {isImporting ? "导入中..." : `导入选中的 ${selected.size} 个`}
          </button>
        </div>
      </div>
    </div>
  );
}
