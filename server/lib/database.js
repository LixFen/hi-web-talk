import Database from "better-sqlite3";
import { DATABASE_FILE, DATA_DIR } from "../constants.js";
import { ensureDir } from "./fileStore.js";

let database = null;

function createDatabaseSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sessionHash TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      rootBlockSHA1 TEXT,
      activeBlockSHA1 TEXT,
      viewState TEXT NOT NULL,
      deletedAt TEXT,
      userId INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_updatedAt
      ON sessions(updatedAt DESC);

    CREATE TABLE IF NOT EXISTS blocks (
      sessionHash TEXT NOT NULL,
      sha1 TEXT NOT NULL,
      blockType TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      modelAlias TEXT NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      reasoning TEXT NOT NULL DEFAULT '',
      tokenUsage TEXT NOT NULL,
      contextLength INTEGER NOT NULL,
      parentBlockSHA1 TEXT,
      flags TEXT NOT NULL,
      meta TEXT NOT NULL,
      PRIMARY KEY (sessionHash, sha1)
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_session_createdAt
      ON blocks(sessionHash, createdAt, sha1);

    CREATE INDEX IF NOT EXISTS idx_blocks_session_parent
      ON blocks(sessionHash, parentBlockSHA1, createdAt, sha1);

    CREATE TABLE IF NOT EXISTS summaries (
      sessionHash TEXT NOT NULL,
      blockSHA1 TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      errorMessage TEXT NOT NULL,
      modelAlias TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      responseId TEXT,
      source TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (sessionHash, blockSHA1)
    );

    CREATE INDEX IF NOT EXISTS idx_summaries_session_createdAt
      ON summaries(sessionHash, createdAt, blockSHA1);

    CREATE TABLE IF NOT EXISTS errors (
      logId TEXT PRIMARY KEY,
      sessionHash TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      operation TEXT NOT NULL,
      parentBlockSHA1 TEXT,
      blockSHA1 TEXT,
      prompt TEXT NOT NULL,
      modelAlias TEXT NOT NULL,
      errorMessage TEXT NOT NULL,
      rawError TEXT NOT NULL,
      meta TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_errors_session_createdAt
      ON errors(sessionHash, createdAt DESC, logId);

    CREATE TABLE IF NOT EXISTS adaptations (
      adaptationId TEXT PRIMARY KEY,
      sessionHash TEXT NOT NULL,
      blockSHA1 TEXT NOT NULL,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      shortLabel TEXT NOT NULL,
      category TEXT NOT NULL,
      kind TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      config TEXT NOT NULL,
      payload TEXT NOT NULL,
      meta TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE (sessionHash, blockSHA1, key)
    );

    CREATE INDEX IF NOT EXISTS idx_adaptations_session_block
      ON adaptations(sessionHash, blockSHA1, key);

    CREATE TABLE IF NOT EXISTS attachments (
      attachmentId TEXT PRIMARY KEY,
      sessionHash TEXT NOT NULL,
      blockSHA1 TEXT,
      fileName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_session
      ON attachments(sessionHash, createdAt);
  `);
}

function runMigrations(db) {
  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all();
  const hasUserId = sessionColumns.some((col) => col.name === "userId");

  if (!hasUserId) {
    db.exec(`ALTER TABLE sessions ADD COLUMN userId INTEGER`);
  }

  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const hasRole = userColumns.some((col) => col.name === "role");

  if (!hasRole) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  }

  const blockColumns = db.prepare("PRAGMA table_info(blocks)").all();
  const hasReasoning = blockColumns.some((col) => col.name === "reasoning");

  if (!hasReasoning) {
    db.exec(`ALTER TABLE blocks ADD COLUMN reasoning TEXT NOT NULL DEFAULT ''`);
  }

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sessions_userId_updatedAt'").all();

  if (indexes.length === 0) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_userId_updatedAt ON sessions(userId, updatedAt DESC)`);
  }
}

export function getDatabase() {
  if (database) {
    return database;
  }

  database = new Database(DATABASE_FILE);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  createDatabaseSchema(database);
  runMigrations(database);
  return database;
}

export async function ensureDatabase() {
  await ensureDir(DATA_DIR);
  getDatabase();
}

export function sessionRowToRecord(row) {
  if (!row) {
    return null;
  }

  if (row.deletedAt) {
    return null;
  }

  return {
    sessionHash: row.sessionHash,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rootBlockSHA1: row.rootBlockSHA1 ?? null,
    activeBlockSHA1: row.activeBlockSHA1 ?? null,
    viewState: row.viewState ? JSON.parse(row.viewState) : {},
    userId: row.userId ?? null,
  };
}

export function recordToSessionRow(session) {
  return {
    sessionHash: session.sessionHash,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    rootBlockSHA1: session.rootBlockSHA1 ?? null,
    activeBlockSHA1: session.activeBlockSHA1 ?? null,
    viewState: JSON.stringify(session.viewState ?? {}),
    deletedAt: session.deletedAt ?? null,
    userId: session.userId ?? null,
  };
}

export function upsertSessionRecord(session) {
  const db = getDatabase();
  const row = recordToSessionRow(session);

  db.prepare(`
    INSERT INTO sessions (
      sessionHash,
      title,
      createdAt,
      updatedAt,
      rootBlockSHA1,
      activeBlockSHA1,
      viewState,
      deletedAt,
      userId
    ) VALUES (
      @sessionHash,
      @title,
      @createdAt,
      @updatedAt,
      @rootBlockSHA1,
      @activeBlockSHA1,
      @viewState,
      @deletedAt,
      @userId
    )
    ON CONFLICT(sessionHash) DO UPDATE SET
      title = excluded.title,
      createdAt = excluded.createdAt,
      updatedAt = excluded.updatedAt,
      rootBlockSHA1 = excluded.rootBlockSHA1,
      activeBlockSHA1 = excluded.activeBlockSHA1,
      viewState = excluded.viewState,
      deletedAt = excluded.deletedAt,
      userId = excluded.userId
  `).run(row);

  return sessionRowToRecord(row);
}

export function readSessionRecord(sessionHash) {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM sessions WHERE sessionHash = ?`).get(sessionHash);
  return sessionRowToRecord(row);
}

export function isSessionDeleted(sessionHash) {
  const db = getDatabase();
  const row = db.prepare(`SELECT deletedAt FROM sessions WHERE sessionHash = ?`).get(sessionHash);
  return Boolean(row?.deletedAt);
}

export function listSessionRecords(userId = null) {
  const db = getDatabase();

  if (userId != null) {
    const rows = db
      .prepare(`SELECT * FROM sessions WHERE deletedAt IS NULL AND userId = ? ORDER BY updatedAt DESC`)
      .all(userId);
    return rows.map(sessionRowToRecord).filter(Boolean);
  }

  const rows = db.prepare(`SELECT * FROM sessions WHERE deletedAt IS NULL ORDER BY updatedAt DESC`).all();
  return rows.map(sessionRowToRecord).filter(Boolean);
}

export function deleteSessionRecord(sessionHash) {
  const db = getDatabase();
  db.prepare(`
    UPDATE sessions
    SET deletedAt = ?
    WHERE sessionHash = ?
  `).run(new Date().toISOString(), sessionHash);
}

function parseMaybeContent(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value !== "string") {
    return String(value);
  }

  if (!value.startsWith("[") && !value.startsWith("{")) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return value;
  } catch {
    return value;
  }
}

export function blockRowToRecord(row) {
  if (!row) {
    return null;
  }

  return {
    sha1: row.sha1,
    sessionHash: row.sessionHash,
    blockType: row.blockType,
    createdAt: row.createdAt,
    modelAlias: row.modelAlias,
    prompt: parseMaybeContent(row.prompt),
    response: parseMaybeContent(row.response),
    reasoning: parseMaybeContent(row.reasoning ?? ""),
    tokenUsage: JSON.parse(row.tokenUsage),
    contextLength: Number(row.contextLength ?? 0),
    parentBlockSHA1: row.parentBlockSHA1 ?? null,
    flags: JSON.parse(row.flags),
    meta: JSON.parse(row.meta),
  };
}

function serializeMaybeContent(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

export function recordToBlockRow(block, sessionHash) {
  return {
    sha1: block.sha1,
    sessionHash,
    blockType: block.blockType,
    createdAt: block.createdAt,
    modelAlias: block.modelAlias,
    prompt: serializeMaybeContent(block.prompt),
    response: serializeMaybeContent(block.response),
    reasoning: serializeMaybeContent(block.reasoning ?? ""),
    tokenUsage: JSON.stringify(block.tokenUsage ?? {}),
    contextLength: Number(block.contextLength ?? 0),
    parentBlockSHA1: block.parentBlockSHA1 ?? null,
    flags: JSON.stringify(block.flags ?? {}),
    meta: JSON.stringify(block.meta ?? {}),
  };
}

export function upsertBlockRecord(sessionHash, block) {
  const db = getDatabase();
  const row = recordToBlockRow(block, sessionHash);

  db.prepare(`
    INSERT INTO blocks (
      sessionHash,
      sha1,
      blockType,
      createdAt,
      modelAlias,
      prompt,
      response,
      reasoning,
      tokenUsage,
      contextLength,
      parentBlockSHA1,
      flags,
      meta
    ) VALUES (
      @sessionHash,
      @sha1,
      @blockType,
      @createdAt,
      @modelAlias,
      @prompt,
      @response,
      @reasoning,
      @tokenUsage,
      @contextLength,
      @parentBlockSHA1,
      @flags,
      @meta
    )
    ON CONFLICT(sessionHash, sha1) DO UPDATE SET
      blockType = excluded.blockType,
      createdAt = excluded.createdAt,
      modelAlias = excluded.modelAlias,
      prompt = excluded.prompt,
      response = excluded.response,
      reasoning = excluded.reasoning,
      tokenUsage = excluded.tokenUsage,
      contextLength = excluded.contextLength,
      parentBlockSHA1 = excluded.parentBlockSHA1,
      flags = excluded.flags,
      meta = excluded.meta
  `).run(row);

  return blockRowToRecord(row);
}

export function readSessionBlockRecord(sessionHash, sha1) {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM blocks WHERE sessionHash = ? AND sha1 = ?`)
    .get(sessionHash, sha1);
  return blockRowToRecord(row);
}

export function listBlockRecords(sessionHash) {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT * FROM blocks WHERE sessionHash = ? ORDER BY createdAt, sha1`)
    .all(sessionHash);
  return rows.map(blockRowToRecord);
}

export function deleteBlockRecords(sessionHash, sha1List = []) {
  const db = getDatabase();

  if (sha1List.length > 0) {
    const placeholders = sha1List.map(() => "?").join(", ");
    db.prepare(`DELETE FROM blocks WHERE sessionHash = ? AND sha1 IN (${placeholders})`).run(
      sessionHash,
      ...sha1List,
    );
    return;
  }

  db.prepare(`DELETE FROM blocks WHERE sessionHash = ?`).run(sessionHash);
}

function parseMaybeJson(value, fallbackValue) {
  if (value === null || value === undefined || value === "") {
    return fallbackValue;
  }

  return JSON.parse(value);
}

export function summaryRowToRecord(row) {
  if (!row) {
    return null;
  }

  return {
    blockSHA1: row.blockSHA1,
    status: row.status,
    summary: row.summary,
    errorMessage: row.errorMessage,
    modelAlias: row.modelAlias,
    provider: row.provider,
    model: row.model,
    responseId: row.responseId ?? null,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function recordToSummaryRow(sessionHash, blockSHA1, record) {
  const now = new Date().toISOString();

  return {
    sessionHash,
    blockSHA1,
    status: record.status ?? "pending",
    summary: record.summary ?? "",
    errorMessage: record.errorMessage ?? "",
    modelAlias: record.modelAlias ?? "",
    provider: record.provider ?? "",
    model: record.model ?? "",
    responseId: record.responseId ?? null,
    source: record.source ?? "system",
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? now,
  };
}

export function upsertSummaryRecord(sessionHash, blockSHA1, record) {
  const db = getDatabase();
  const row = recordToSummaryRow(sessionHash, blockSHA1, record);

  db.prepare(`
    INSERT INTO summaries (
      sessionHash,
      blockSHA1,
      status,
      summary,
      errorMessage,
      modelAlias,
      provider,
      model,
      responseId,
      source,
      createdAt,
      updatedAt
    ) VALUES (
      @sessionHash,
      @blockSHA1,
      @status,
      @summary,
      @errorMessage,
      @modelAlias,
      @provider,
      @model,
      @responseId,
      @source,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(sessionHash, blockSHA1) DO UPDATE SET
      status = excluded.status,
      summary = excluded.summary,
      errorMessage = excluded.errorMessage,
      modelAlias = excluded.modelAlias,
      provider = excluded.provider,
      model = excluded.model,
      responseId = excluded.responseId,
      source = excluded.source,
      createdAt = excluded.createdAt,
      updatedAt = excluded.updatedAt
  `).run(row);

  return summaryRowToRecord(row);
}

export function listSummaryRecords(sessionHash) {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT * FROM summaries WHERE sessionHash = ? ORDER BY createdAt, blockSHA1`)
    .all(sessionHash);
  return rows.map(summaryRowToRecord);
}

export function readSummaryRecord(sessionHash, blockSHA1) {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM summaries WHERE sessionHash = ? AND blockSHA1 = ?`)
    .get(sessionHash, blockSHA1);
  return summaryRowToRecord(row);
}

export function deleteSummaryRecordsForBlocks(sessionHash, blockSHA1s = []) {
  const db = getDatabase();

  if (blockSHA1s.length > 0) {
    const placeholders = blockSHA1s.map(() => "?").join(", ");
    const result = db.prepare(`DELETE FROM summaries WHERE sessionHash = ? AND blockSHA1 IN (${placeholders})`).run(
      sessionHash,
      ...blockSHA1s,
    );
    return result.changes;
  }

  const result = db.prepare(`DELETE FROM summaries WHERE sessionHash = ?`).run(sessionHash);
  return result.changes;
}

export function errorRowToRecord(row) {
  if (!row) {
    return null;
  }

  return {
    logId: row.logId,
    createdAt: row.createdAt,
    sessionHash: row.sessionHash,
    operation: row.operation,
    parentBlockSHA1: row.parentBlockSHA1 ?? null,
    blockSHA1: row.blockSHA1 ?? null,
    prompt: row.prompt,
    modelAlias: row.modelAlias,
    errorMessage: row.errorMessage,
    rawError: parseMaybeJson(row.rawError, {}),
    meta: parseMaybeJson(row.meta, {}),
  };
}

export function recordToErrorRow(entry) {
  return {
    logId: entry.logId,
    createdAt: entry.createdAt,
    sessionHash: entry.sessionHash,
    operation: entry.operation,
    parentBlockSHA1: entry.parentBlockSHA1 ?? null,
    blockSHA1: entry.blockSHA1 ?? null,
    prompt: entry.prompt ?? "",
    modelAlias: entry.modelAlias ?? "",
    errorMessage: entry.errorMessage ?? "",
    rawError: JSON.stringify(entry.rawError ?? {}),
    meta: JSON.stringify(entry.meta ?? {}),
  };
}

export function insertErrorRecord(entry) {
  const db = getDatabase();
  const row = recordToErrorRow(entry);

  db.prepare(`
    INSERT INTO errors (
      logId,
      sessionHash,
      createdAt,
      operation,
      parentBlockSHA1,
      blockSHA1,
      prompt,
      modelAlias,
      errorMessage,
      rawError,
      meta
    ) VALUES (
      @logId,
      @sessionHash,
      @createdAt,
      @operation,
      @parentBlockSHA1,
      @blockSHA1,
      @prompt,
      @modelAlias,
      @errorMessage,
      @rawError,
      @meta
    )
    ON CONFLICT(logId) DO UPDATE SET
      sessionHash = excluded.sessionHash,
      createdAt = excluded.createdAt,
      operation = excluded.operation,
      parentBlockSHA1 = excluded.parentBlockSHA1,
      blockSHA1 = excluded.blockSHA1,
      prompt = excluded.prompt,
      modelAlias = excluded.modelAlias,
      errorMessage = excluded.errorMessage,
      rawError = excluded.rawError,
      meta = excluded.meta
  `).run(row);

  return errorRowToRecord(row);
}

export function listErrorRecords(sessionHash) {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT * FROM errors WHERE sessionHash = ? ORDER BY createdAt DESC, logId DESC`)
    .all(sessionHash);
  return rows.map(errorRowToRecord);
}

export function deleteErrorRecordsForBlocks(sessionHash, blockSHA1s = []) {
  const db = getDatabase();

  if (blockSHA1s.length > 0) {
    const placeholders = blockSHA1s.map(() => "?").join(", ");
    db.prepare(
      `DELETE FROM errors WHERE sessionHash = ? AND (blockSHA1 IN (${placeholders}) OR parentBlockSHA1 IN (${placeholders}))`,
    ).run(sessionHash, ...blockSHA1s, ...blockSHA1s);
    return;
  }

  db.prepare(`DELETE FROM errors WHERE sessionHash = ?`).run(sessionHash);
}

export function adaptationRowToRecord(row) {
  if (!row) {
    return null;
  }

  return {
    adaptationId: row.adaptationId,
    blockSHA1: row.blockSHA1,
    key: row.key,
    label: row.label,
    shortLabel: row.shortLabel,
    category: row.category,
    kind: row.kind,
    description: row.description,
    enabled: Boolean(row.enabled),
    status: row.status,
    source: row.source,
    config: parseMaybeJson(row.config, {}),
    payload: parseMaybeJson(row.payload, {}),
    meta: parseMaybeJson(row.meta, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function recordToAdaptationRow(sessionHash, blockSHA1, key, record) {
  const now = new Date().toISOString();

  return {
    adaptationId: record.adaptationId,
    sessionHash,
    blockSHA1,
    key,
    label: record.label,
    shortLabel: record.shortLabel,
    category: record.category,
    kind: record.kind,
    description: record.description,
    enabled: record.enabled ? 1 : 0,
    status: record.status,
    source: record.source ?? "user",
    config: JSON.stringify(record.config ?? {}),
    payload: JSON.stringify(record.payload ?? {}),
    meta: JSON.stringify(record.meta ?? {}),
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? now,
  };
}

export function upsertAdaptationRecord(sessionHash, blockSHA1, key, record) {
  const db = getDatabase();
  const row = recordToAdaptationRow(sessionHash, blockSHA1, key, record);

  db.prepare(`
    INSERT INTO adaptations (
      adaptationId,
      sessionHash,
      blockSHA1,
      key,
      label,
      shortLabel,
      category,
      kind,
      description,
      enabled,
      status,
      source,
      config,
      payload,
      meta,
      createdAt,
      updatedAt
    ) VALUES (
      @adaptationId,
      @sessionHash,
      @blockSHA1,
      @key,
      @label,
      @shortLabel,
      @category,
      @kind,
      @description,
      @enabled,
      @status,
      @source,
      @config,
      @payload,
      @meta,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(sessionHash, blockSHA1, key) DO UPDATE SET
      adaptationId = excluded.adaptationId,
      label = excluded.label,
      shortLabel = excluded.shortLabel,
      category = excluded.category,
      kind = excluded.kind,
      description = excluded.description,
      enabled = excluded.enabled,
      status = excluded.status,
      source = excluded.source,
      config = excluded.config,
      payload = excluded.payload,
      meta = excluded.meta,
      createdAt = excluded.createdAt,
      updatedAt = excluded.updatedAt
  `).run(row);

  return adaptationRowToRecord(row);
}

export function listAdaptationRecords(sessionHash) {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT * FROM adaptations WHERE sessionHash = ? ORDER BY blockSHA1, key`)
    .all(sessionHash);
  return rows.map(adaptationRowToRecord);
}

export function readAdaptationRecord(sessionHash, blockSHA1, key) {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM adaptations WHERE sessionHash = ? AND blockSHA1 = ? AND key = ?`)
    .get(sessionHash, blockSHA1, key);
  return adaptationRowToRecord(row);
}

export function createUserRecord(username, passwordHash, role = "user") {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO users (username, passwordHash, role, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(username, passwordHash, role, now, now);
  return { id: result.lastInsertRowid, username, role, createdAt: now };
}

export function findUserByUsername(username) {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) ?? null;
}

export function findUserById(id) {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) ?? null;
}

export function deleteAdaptationRecordsForBlocks(sessionHash, blockSHA1s = []) {
  const db = getDatabase();

  if (blockSHA1s.length > 0) {
    const placeholders = blockSHA1s.map(() => "?").join(", ");
    const result = db.prepare(`DELETE FROM adaptations WHERE sessionHash = ? AND blockSHA1 IN (${placeholders})`).run(
      sessionHash,
      ...blockSHA1s,
    );
    return result.changes;
  }

  const result = db.prepare(`DELETE FROM adaptations WHERE sessionHash = ?`).run(sessionHash);
  return result.changes;
}