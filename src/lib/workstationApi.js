import { getToken } from "./tokenStore.js";

async function requestJson(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    headers,
    ...options,
  });

  const responseText = await response.text();
  let data = null;
  let parseError = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      parseError = error;
    }
  }

  if (!response.ok) {
    if (data?.error) {
      throw new Error(data.error);
    }

    if (responseText) {
      throw new Error(responseText);
    }

    throw new Error("请求失败，请稍后再试。");
  }

  if (responseText && parseError) {
    throw new Error("接口返回了无效 JSON，可能包含未正确转义的特殊字符。");
  }

  return data;
}

// ============================================================
// Groups
// ============================================================

export async function listGroups() {
  return requestJson("/api/workstation/groups");
}

export async function createGroup(name) {
  return requestJson("/api/workstation/groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function updateGroup(groupId, data) {
  return requestJson(`/api/workstation/groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteGroup(groupId) {
  return requestJson(`/api/workstation/groups/${groupId}`, {
    method: "DELETE",
  });
}

export async function reorderGroups(groupIds) {
  return requestJson("/api/workstation/groups/reorder", {
    method: "PATCH",
    body: JSON.stringify({ groupIds }),
  });
}

// ============================================================
// Sessions in groups
// ============================================================

export async function addSessionToGroup(sessionHash, groupId) {
  return requestJson(`/api/workstation/sessions/${sessionHash}/groups`, {
    method: "POST",
    body: JSON.stringify({ groupId }),
  });
}

export async function removeSessionFromGroup(sessionHash, groupId) {
  return requestJson(`/api/workstation/sessions/${sessionHash}/groups/${groupId}`, {
    method: "DELETE",
  });
}

export async function getSessionGroups(sessionHash) {
  return requestJson(`/api/workstation/sessions/${sessionHash}/groups`);
}

export async function getGroupSessions(groupId) {
  return requestJson(`/api/workstation/groups/${groupId}/sessions`);
}

export async function updateSessionPosition(sessionHash, groupId, data) {
  return requestJson(`/api/workstation/sessions/${sessionHash}/groups/${groupId}/position`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function listUngroupedSessions() {
  return requestJson("/api/workstation/ungrouped");
}

// ============================================================
// Connections
// ============================================================

export async function listConnections() {
  return requestJson("/api/workstation/connections");
}

export async function listAllLabels() {
  return requestJson("/api/workstation/connections/labels");
}

export async function createConnection(sourceSessionHash, targetSessionHash, label = "", sourceGroupId = null, targetGroupId = null) {
  return requestJson("/api/workstation/connections", {
    method: "POST",
    body: JSON.stringify({ sourceSessionHash, targetSessionHash, label, sourceGroupId, targetGroupId }),
  });
}

export async function updateConnection(connId, data) {
  return requestJson(`/api/workstation/connections/${connId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteConnection(connId) {
  return requestJson(`/api/workstation/connections/${connId}`, {
    method: "DELETE",
  });
}

// ============================================================
// Cleanup
// ============================================================

export async function cleanupDeletedSession(sessionHash) {
  return requestJson(`/api/workstation/sessions/${sessionHash}`, {
    method: "DELETE",
  });
}

// ============================================================
// Preset labels
// ============================================================

export async function getPresetLabels() {
  return requestJson("/api/workstation/preset-labels");
}

// ============================================================
// DevTools
// ============================================================

export async function clearAllConnections() {
  return requestJson("/api/workstation/dev/connections", { method: "DELETE" });
}

export async function clearAllGroups() {
  return requestJson("/api/workstation/dev/groups", { method: "DELETE" });
}
