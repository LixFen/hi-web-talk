import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "./AuthContext";
import {
  listGroups as apiListGroups,
  createGroup as apiCreateGroup,
  updateGroup as apiUpdateGroup,
  deleteGroup as apiDeleteGroup,
  reorderGroups as apiReorderGroups,
  addSessionToGroup as apiAddSessionToGroup,
  removeSessionFromGroup as apiRemoveSessionFromGroup,
  getSessionGroups as apiGetSessionGroups,
  getGroupSessions as apiGetGroupSessions,
  updateSessionPosition as apiUpdateSessionPosition,
  listUngroupedSessions as apiListUngroupedSessions,
  listConnections as apiListConnections,
  createConnection as apiCreateConnection,
  updateConnection as apiUpdateConnection,
  deleteConnection as apiDeleteConnection,
  cleanupDeletedSession as apiCleanupDeletedSession,
  getPresetLabels as apiGetPresetLabels,
  clearAllConnections as apiClearAllConnections,
  clearAllGroups as apiClearAllGroups,
} from "../lib/workstationApi";

const WorkStationContext = createContext(null);

export function WorkStationProvider({ children }) {
  const { isAuthenticated } = useAuth();

  const [groups, setGroups] = useState([]);
  const [groupSessions, setGroupSessions] = useState({}); // groupId -> sessions[]
  const [ungroupedSessions, setUngroupedSessions] = useState([]);
  const [connections, setConnections] = useState([]);
  const [presetLabels, setPresetLabels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load all workstation data
  const loadWorkstationData = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    setError(null);

    try {
      const [groupsResult, connectionsResult, ungroupedResult, labelsResult] =
        await Promise.all([
          apiListGroups(),
          apiListConnections(),
          apiListUngroupedSessions(),
          apiGetPresetLabels(),
        ]);

      const loadedGroups = groupsResult.groups || [];
      setGroups(loadedGroups);
      setConnections(connectionsResult.connections || []);
      setUngroupedSessions(ungroupedResult.sessions || []);
      setPresetLabels(labelsResult.labels || []);

      // Load sessions for each group
      const sessionsMap = {};
      await Promise.all(
        loadedGroups.map(async (group) => {
          try {
            const result = await apiGetGroupSessions(group.id);
            sessionsMap[group.id] = result.sessions || [];
          } catch {
            sessionsMap[group.id] = [];
          }
        })
      );
      setGroupSessions(sessionsMap);
    } catch (err) {
      console.error("Load workstation data error:", err);
      setError(err.message || "加载WorkStation数据失败。");
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  // Load data on auth change
  useEffect(() => {
    if (isAuthenticated) {
      loadWorkstationData();
    }
  }, [isAuthenticated, loadWorkstationData]);

  // ============================================================
  // Groups
  // ============================================================

  const createGroup = useCallback(async (name) => {
    try {
      const result = await apiCreateGroup(name);
      const newGroup = result.group;
      setGroups((prev) => [...prev, newGroup]);
      setGroupSessions((prev) => ({ ...prev, [newGroup.id]: [] }));
      return newGroup;
    } catch (err) {
      setError(err.message || "创建分组失败。");
      throw err;
    }
  }, []);

  const updateGroup = useCallback(async (groupId, data) => {
    try {
      const result = await apiUpdateGroup(groupId, data);
      const updated = result.group;
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? updated : g))
      );
      return updated;
    } catch (err) {
      setError(err.message || "更新分组失败。");
      throw err;
    }
  }, []);

  const deleteGroup = useCallback(async (groupId) => {
    try {
      await apiDeleteGroup(groupId);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setGroupSessions((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    } catch (err) {
      setError(err.message || "删除分组失败。");
      throw err;
    }
  }, []);

  const reorderGroupsAction = useCallback(async (groupIds) => {
    try {
      await apiReorderGroups(groupIds);
      setGroups((prev) => {
        const map = new Map(prev.map((g) => [g.id, g]));
        return groupIds
          .map((id) => map.get(id))
          .filter(Boolean)
          .map((g, i) => ({ ...g, position: i }));
      });
    } catch (err) {
      setError(err.message || "重排序分组失败。");
      throw err;
    }
  }, []);

  // ============================================================
  // Session-Group associations
  // ============================================================

  const addSessionToGroup = useCallback(async (sessionHash, groupId) => {
    try {
      await apiAddSessionToGroup(sessionHash, groupId);
      // Reload group sessions
      const result = await apiGetGroupSessions(groupId);
      setGroupSessions((prev) => ({
        ...prev,
        [groupId]: result.sessions || [],
      }));
      // Remove from ungrouped if present
      setUngroupedSessions((prev) =>
        prev.filter((s) => s.sessionHash !== sessionHash)
      );
    } catch (err) {
      setError(err.message || "添加session到分组失败。");
      throw err;
    }
  }, []);

  const removeSessionFromGroup = useCallback(async (sessionHash, groupId) => {
    try {
      await apiRemoveSessionFromGroup(sessionHash, groupId);
      // Reload group sessions
      const result = await apiGetGroupSessions(groupId);
      setGroupSessions((prev) => ({
        ...prev,
        [groupId]: result.sessions || [],
      }));
      // Check if session is still in any group
      const groupsResult = await apiGetSessionGroups(sessionHash);
      if ((groupsResult.groups || []).length === 0) {
        // Session is now ungrouped, reload ungrouped list
        const ungroupedResult = await apiListUngroupedSessions();
        setUngroupedSessions(ungroupedResult.sessions || []);
      }
    } catch (err) {
      setError(err.message || "从分组移除session失败。");
      throw err;
    }
  }, []);

  const updateSessionPosition = useCallback(async (sessionHash, groupId, data) => {
    try {
      const result = await apiUpdateSessionPosition(sessionHash, groupId, data);
      const updated = result.position;
      setGroupSessions((prev) => ({
        ...prev,
        [groupId]: (prev[groupId] || []).map((s) =>
          s.sessionHash === sessionHash ? { ...s, ...updated } : s
        ),
      }));
      return updated;
    } catch (err) {
      setError(err.message || "更新session位置失败。");
      throw err;
    }
  }, []);

  const refreshGroupSessions = useCallback(async (groupId) => {
    try {
      const result = await apiGetGroupSessions(groupId);
      setGroupSessions((prev) => ({
        ...prev,
        [groupId]: result.sessions || [],
      }));
    } catch (err) {
      console.error("Refresh group sessions error:", err);
    }
  }, []);

  const refreshUngroupedSessions = useCallback(async () => {
    try {
      const result = await apiListUngroupedSessions();
      setUngroupedSessions(result.sessions || []);
    } catch (err) {
      console.error("Refresh ungrouped sessions error:", err);
    }
  }, []);

  // ============================================================
  // Connections
  // ============================================================

  const createConnection = useCallback(async (sourceSessionHash, targetSessionHash, label = "", sourceGroupId = null, targetGroupId = null) => {
    try {
      const result = await apiCreateConnection(sourceSessionHash, targetSessionHash, label, sourceGroupId, targetGroupId);
      const newConn = result.connection;
      setConnections((prev) => [...prev, newConn]);
      return newConn;
    } catch (err) {
      setError(err.message || "创建连线失败。");
      throw err;
    }
  }, []);

  const updateConnection = useCallback(async (connId, data) => {
    try {
      const result = await apiUpdateConnection(connId, data);
      const updated = result.connection;
      setConnections((prev) =>
        prev.map((c) => (c.id === connId ? updated : c))
      );
      return updated;
    } catch (err) {
      setError(err.message || "更新连线失败。");
      throw err;
    }
  }, []);

  const deleteConnection = useCallback(async (connId) => {
    try {
      await apiDeleteConnection(connId);
      setConnections((prev) => prev.filter((c) => c.id !== connId));
    } catch (err) {
      setError(err.message || "删除连线失败。");
      throw err;
    }
  }, []);

  // ============================================================
  // Cleanup
  // ============================================================

  const cleanupDeletedSession = useCallback(async (sessionHash) => {
    try {
      await apiCleanupDeletedSession(sessionHash);
      // Remove from all groups
      setGroupSessions((prev) => {
        const next = {};
        for (const [gid, sessions] of Object.entries(prev)) {
          next[gid] = sessions.filter((s) => s.sessionHash !== sessionHash);
        }
        return next;
      });
      // Remove connections
      setConnections((prev) =>
        prev.filter(
          (c) =>
            c.sourceSessionHash !== sessionHash &&
            c.targetSessionHash !== sessionHash
        )
      );
      // Remove from ungrouped
      setUngroupedSessions((prev) =>
        prev.filter((s) => s.sessionHash !== sessionHash)
      );
    } catch (err) {
      setError(err.message || "清理已删除session失败。");
      throw err;
    }
  }, []);

  // DevTools
  const devClearAllConnections = useCallback(async () => {
    try {
      await apiClearAllConnections();
      setConnections([]);
    } catch (err) {
      setError(err.message || "清除连线失败。");
      throw err;
    }
  }, []);

  const devClearAllGroups = useCallback(async () => {
    try {
      await apiClearAllGroups();
      setGroups([]);
      setGroupSessions({});
      setConnections([]);
      setUngroupedSessions([]);
    } catch (err) {
      setError(err.message || "清除分组失败。");
      throw err;
    }
  }, []);

  // ============================================================
  // Context value
  // ============================================================

  const value = useMemo(
    () => ({
      // State
      groups,
      groupSessions,
      ungroupedSessions,
      connections,
      presetLabels,
      isLoading,
      error,

      // Actions
      loadWorkstationData,
      createGroup,
      updateGroup,
      deleteGroup,
      reorderGroups: reorderGroupsAction,
      addSessionToGroup,
      removeSessionFromGroup,
      updateSessionPosition,
      getSessionGroups: apiGetSessionGroups,
      refreshGroupSessions,
      refreshUngroupedSessions,
      createConnection,
      updateConnection,
      deleteConnection,
      cleanupDeletedSession,
      setError,
      devClearAllConnections,
      devClearAllGroups,
    }),
    [
      groups,
      groupSessions,
      ungroupedSessions,
      connections,
      presetLabels,
      isLoading,
      error,
      loadWorkstationData,
      createGroup,
      updateGroup,
      deleteGroup,
      reorderGroupsAction,
      addSessionToGroup,
      removeSessionFromGroup,
      updateSessionPosition,
      apiGetSessionGroups,
      refreshGroupSessions,
      refreshUngroupedSessions,
      createConnection,
      updateConnection,
      deleteConnection,
      cleanupDeletedSession,
      devClearAllConnections,
      devClearAllGroups,
    ]
  );

  return (
    <WorkStationContext.Provider value={value}>
      {children}
    </WorkStationContext.Provider>
  );
}

export function useWorkStation() {
  const context = useContext(WorkStationContext);
  if (!context) {
    throw new Error("useWorkStation must be used within a WorkStationProvider");
  }
  return context;
}
