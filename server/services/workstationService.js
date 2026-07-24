import { ensureDatabase, getDatabase } from "../lib/database.js";

// ============================================================
// Groups
// ============================================================

export async function listGroups(userId) {
  await ensureDatabase();
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, userId, name, position, isCollapsed, columnWidth, posX, posY, height, viewMode, createdAt, updatedAt
       FROM workstation_groups
       WHERE userId = ?
       ORDER BY position ASC`
    )
    .all(userId);
}

export async function createGroup(userId, name) {
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();

  // Get max position
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) AS maxPos
       FROM workstation_groups
       WHERE userId = ?`
    )
    .get(userId);

  const position = row.maxPos + 1;

  const result = db
    .prepare(
      `INSERT INTO workstation_groups (userId, name, position, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, name, position, now, now);

  return {
    id: result.lastInsertRowid,
    userId,
    name,
    position,
    isCollapsed: 0,
    columnWidth: 280,
    posX: null,
    posY: null,
    height: null,
    viewMode: "list",
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateGroup(groupId, userId, data) {
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();

  const fields = [];
  const values = [];

  if (data.name !== undefined) {
    fields.push("name = ?");
    values.push(data.name);
  }
  if (data.position !== undefined) {
    fields.push("position = ?");
    values.push(data.position);
  }
  if (data.isCollapsed !== undefined) {
    fields.push("isCollapsed = ?");
    values.push(data.isCollapsed ? 1 : 0);
  }
  if (data.columnWidth !== undefined) {
    fields.push("columnWidth = ?");
    values.push(data.columnWidth);
  }
  if (data.posX !== undefined) {
    fields.push("posX = ?");
    values.push(data.posX);
  }
  if (data.posY !== undefined) {
    fields.push("posY = ?");
    values.push(data.posY);
  }
  if (data.height !== undefined) {
    fields.push("height = ?");
    values.push(data.height);
  }
  if (data.viewMode !== undefined) {
    fields.push("viewMode = ?");
    values.push(data.viewMode);
  }

  if (fields.length === 0) {
    return getGroup(groupId, userId);
  }

  fields.push("updatedAt = ?");
  values.push(now);
  values.push(groupId);
  values.push(userId);

  db.prepare(
    `UPDATE workstation_groups
     SET ${fields.join(", ")}
     WHERE id = ? AND userId = ?`
  ).run(...values);

  return getGroup(groupId, userId);
}

export async function getGroup(groupId, userId) {
  await ensureDatabase();
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, userId, name, position, isCollapsed, columnWidth, posX, posY, height, viewMode, createdAt, updatedAt
       FROM workstation_groups
       WHERE id = ? AND userId = ?`
    )
    .get(groupId, userId);
}

export async function deleteGroup(groupId, userId) {
  await ensureDatabase();
  const db = getDatabase();
  // CASCADE will handle workstation_session_groups
  db.prepare(
    `DELETE FROM workstation_groups WHERE id = ? AND userId = ?`
  ).run(groupId, userId);
}

export async function reorderGroups(userId, groupIds) {
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `UPDATE workstation_groups SET position = ?, updatedAt = ? WHERE id = ? AND userId = ?`
  );

  const updateMany = db.transaction((ids) => {
    for (let i = 0; i < ids.length; i++) {
      stmt.run(i, now, ids[i], userId);
    }
  });

  updateMany(groupIds);
}

// ============================================================
// Session-Group associations
// ============================================================

export async function addSessionToGroup(sessionHash, groupId, userId) {
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();

  // Verify ownership
  const group = await getGroup(groupId, userId);
  if (!group) {
    throw new Error("Group not found");
  }

  try {
    db.prepare(
      `INSERT INTO workstation_session_groups (sessionHash, groupId, addedAt)
       VALUES (?, ?, ?)`
    ).run(sessionHash, groupId, now);
    return true;
  } catch (err) {
    // Ignore duplicate
    if (err.message.includes("UNIQUE constraint")) {
      return false;
    }
    throw err;
  }
}

export async function removeSessionFromGroup(sessionHash, groupId, userId) {
  await ensureDatabase();
  const db = getDatabase();

  // Verify ownership
  const group = await getGroup(groupId, userId);
  if (!group) {
    throw new Error("Group not found");
  }

  db.prepare(
    `DELETE FROM workstation_session_groups
     WHERE sessionHash = ? AND groupId = ?`
  ).run(sessionHash, groupId);
}

export async function getSessionGroups(sessionHash) {
  await ensureDatabase();
  const db = getDatabase();
  return db
    .prepare(
      `SELECT g.id, g.name, g.position
       FROM workstation_groups g
       INNER JOIN workstation_session_groups sg ON g.id = sg.groupId
       WHERE sg.sessionHash = ?
       ORDER BY g.position ASC`
    )
    .all(sessionHash);
}

export async function getGroupSessions(groupId, userId) {
  await ensureDatabase();
  const db = getDatabase();

  // Verify ownership
  const group = await getGroup(groupId, userId);
  if (!group) {
    throw new Error("Group not found");
  }

  return db
    .prepare(
      `SELECT s.sessionHash, s.title, s.createdAt, s.updatedAt, s.deletedAt,
              sg.posX, sg.posY, sg.width, sg.height
       FROM sessions s
       INNER JOIN workstation_session_groups sg ON s.sessionHash = sg.sessionHash
       WHERE sg.groupId = ?
       ORDER BY s.updatedAt DESC`
    )
    .all(groupId);
}

export async function updateSessionPositionInGroup(sessionHash, groupId, userId, data) {
  await ensureDatabase();
  const db = getDatabase();

  // Verify ownership
  const group = await getGroup(groupId, userId);
  if (!group) {
    throw new Error("Group not found");
  }

  const fields = [];
  const values = [];

  if (data.posX !== undefined) {
    fields.push("posX = ?");
    values.push(data.posX);
  }
  if (data.posY !== undefined) {
    fields.push("posY = ?");
    values.push(data.posY);
  }
  if (data.width !== undefined) {
    fields.push("width = ?");
    values.push(data.width);
  }
  if (data.height !== undefined) {
    fields.push("height = ?");
    values.push(data.height);
  }

  if (fields.length === 0) {
    return { sessionHash, groupId };
  }

  values.push(sessionHash, groupId);

  db.prepare(
    `UPDATE workstation_session_groups
     SET ${fields.join(", ")}
     WHERE sessionHash = ? AND groupId = ?`
  ).run(...values);

  return db
    .prepare(
      `SELECT sessionHash, groupId, posX, posY, width, height
       FROM workstation_session_groups
       WHERE sessionHash = ? AND groupId = ?`
    )
    .get(sessionHash, groupId);
}

export async function listUngroupedSessions(userId) {
  await ensureDatabase();
  const db = getDatabase();
  return db
    .prepare(
      `SELECT s.sessionHash, s.title, s.createdAt, s.updatedAt, s.deletedAt
       FROM sessions s
       WHERE s.userId = ?
         AND s.deletedAt IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM workstation_session_groups sg
           WHERE sg.sessionHash = s.sessionHash
         )
       ORDER BY s.updatedAt DESC`
    )
    .all(userId);
}

export async function getAllWorkstationSessions(userId) {
  await ensureDatabase();
  const db = getDatabase();
  return db
    .prepare(
      `SELECT DISTINCT s.sessionHash, s.title, s.createdAt, s.updatedAt, s.deletedAt
       FROM sessions s
       INNER JOIN workstation_session_groups sg ON s.sessionHash = sg.sessionHash
       WHERE s.userId = ?
       ORDER BY s.updatedAt DESC`
    )
    .all(userId);
}

// ============================================================
// Connections
// ============================================================

export async function listConnections(userId) {
  await ensureDatabase();
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, userId, sourceSessionHash, targetSessionHash, sourceGroupId, targetGroupId, label, annotation, arrowType, createdAt, updatedAt
       FROM workstation_connections
       WHERE userId = ?
       ORDER BY createdAt ASC`
    )
    .all(userId);
}

export async function createConnection(userId, sourceSessionHash, targetSessionHash, label = "", annotation = "", arrowType = "forward", sourceGroupId = null, targetGroupId = null) {
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();

  // Prevent self-connection
  if (sourceSessionHash === targetSessionHash) {
    throw new Error("Cannot connect a session to itself");
  }

  // Check for duplicate (same group context)
  const existing = db
    .prepare(
      `SELECT id FROM workstation_connections
       WHERE userId = ? AND sourceSessionHash = ? AND targetSessionHash = ?
         AND sourceGroupId IS ? AND targetGroupId IS ?`
    )
    .get(userId, sourceSessionHash, targetSessionHash, sourceGroupId, targetGroupId);

  if (existing) {
    return existing;
  }

  const result = db
    .prepare(
      `INSERT INTO workstation_connections (userId, sourceSessionHash, targetSessionHash, sourceGroupId, targetGroupId, label, annotation, arrowType, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, sourceSessionHash, targetSessionHash, sourceGroupId, targetGroupId, label, annotation, arrowType, now, now);

  return {
    id: result.lastInsertRowid,
    userId,
    sourceSessionHash,
    targetSessionHash,
    sourceGroupId,
    targetGroupId,
    label,
    annotation,
    arrowType,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateConnection(connId, userId, data) {
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();

  const fields = [];
  const values = [];

  if (data.label !== undefined) {
    fields.push("label = ?");
    values.push(data.label);
  }
  if (data.annotation !== undefined) {
    fields.push("annotation = ?");
    values.push(data.annotation);
  }
  if (data.arrowType !== undefined) {
    fields.push("arrowType = ?");
    values.push(data.arrowType);
  }

  if (fields.length === 0) {
    return getConnection(connId, userId);
  }

  fields.push("updatedAt = ?");
  values.push(now);
  values.push(connId);
  values.push(userId);

  db.prepare(
    `UPDATE workstation_connections
     SET ${fields.join(", ")}
     WHERE id = ? AND userId = ?`
  ).run(...values);

  return getConnection(connId, userId);
}

export async function getConnection(connId, userId) {
  await ensureDatabase();
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, userId, sourceSessionHash, targetSessionHash, label, annotation, arrowType, createdAt, updatedAt
       FROM workstation_connections
       WHERE id = ? AND userId = ?`
    )
    .get(connId, userId);
}

export async function deleteConnection(connId, userId) {
  await ensureDatabase();
  const db = getDatabase();
  db.prepare(
    `DELETE FROM workstation_connections WHERE id = ? AND userId = ?`
  ).run(connId, userId);
}

export async function deleteConnectionsForSession(sessionHash) {
  await ensureDatabase();
  const db = getDatabase();
  db.prepare(
    `DELETE FROM workstation_connections
     WHERE sourceSessionHash = ? OR targetSessionHash = ?`
  ).run(sessionHash, sessionHash);
}

// ============================================================
// Cleanup for deleted sessions
// ============================================================

export async function cleanupDeletedSession(sessionHash) {
  await ensureDatabase();
  const db = getDatabase();
  // Remove from all groups
  db.prepare(
    `DELETE FROM workstation_session_groups WHERE sessionHash = ?`
  ).run(sessionHash);
  // Remove all connections
  await deleteConnectionsForSession(sessionHash);
}

// ============================================================
// Preset labels
// ============================================================

const DEFAULT_PRESET_LABELS = [
  "相关",
  "依赖",
  "参考",
  "延续",
  "对比",
  "补充",
];

export function getPresetLabels() {
  return DEFAULT_PRESET_LABELS;
}

// ============================================================
// DevTools: bulk clear
// ============================================================

export async function clearAllConnections(userId) {
  await ensureDatabase();
  const db = getDatabase();
  db.prepare("DELETE FROM workstation_connections WHERE userId = ?").run(userId);
}

export async function clearAllGroups(userId) {
  await ensureDatabase();
  const db = getDatabase();
  // CASCADE will handle workstation_session_groups
  db.prepare("DELETE FROM workstation_groups WHERE userId = ?").run(userId);
  // Also clear connections (orphaned after groups removed)
  db.prepare("DELETE FROM workstation_connections WHERE userId = ?").run(userId);
}

export async function listAllLabels(userId) {
  await ensureDatabase();
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT DISTINCT label FROM workstation_connections
       WHERE userId = ? AND label != ''
       ORDER BY label ASC`
    )
    .all(userId);
  return rows.map((r) => r.label);
}
