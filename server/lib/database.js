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
      userId INTEGER,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
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
      PRIMARY KEY (sessionHash, sha1),
      FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
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
      PRIMARY KEY (sessionHash, blockSHA1),
      FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
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
      meta TEXT NOT NULL,
      FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
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
      UNIQUE (sessionHash, blockSHA1, key),
      FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
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
      createdAt TEXT NOT NULL,
      FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_session
      ON attachments(sessionHash, createdAt);
  `);
}

function addForeignKeysToExistingTables(db) {
  const childTables = ["blocks", "summaries", "errors", "adaptations", "attachments"];
  const tablesMissingForeignKeys = childTables.filter((table) => {
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    return fks.length === 0;
  });

  if (tablesMissingForeignKeys.length === 0) {
    return;
  }

  const tableDefs = [
    {
      name: "blocks",
      ddl: `CREATE TABLE blocks_new (
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
        PRIMARY KEY (sessionHash, sha1),
        FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
      )`,
      indexes: [
        `CREATE INDEX idx_blocks_session_createdAt ON blocks(sessionHash, createdAt, sha1)`,
        `CREATE INDEX idx_blocks_session_parent ON blocks(sessionHash, parentBlockSHA1, createdAt, sha1)`,
      ],
    },
    {
      name: "summaries",
      ddl: `CREATE TABLE summaries_new (
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
        PRIMARY KEY (sessionHash, blockSHA1),
        FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
      )`,
      indexes: [
        `CREATE INDEX idx_summaries_session_createdAt ON summaries(sessionHash, createdAt, blockSHA1)`,
      ],
    },
    {
      name: "errors",
      ddl: `CREATE TABLE errors_new (
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
        meta TEXT NOT NULL,
        FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
      )`,
      indexes: [
        `CREATE INDEX idx_errors_session_createdAt ON errors(sessionHash, createdAt DESC, logId)`,
      ],
    },
    {
      name: "adaptations",
      ddl: `CREATE TABLE adaptations_new (
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
        UNIQUE (sessionHash, blockSHA1, key),
        FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
      )`,
      indexes: [
        `CREATE INDEX idx_adaptations_session_block ON adaptations(sessionHash, blockSHA1, key)`,
      ],
    },
    {
      name: "attachments",
      ddl: `CREATE TABLE attachments_new (
        attachmentId TEXT PRIMARY KEY,
        sessionHash TEXT NOT NULL,
        blockSHA1 TEXT,
        fileName TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        size INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (sessionHash) REFERENCES sessions(sessionHash) ON DELETE CASCADE
      )`,
      indexes: [
        `CREATE INDEX idx_attachments_session ON attachments(sessionHash, createdAt)`,
      ],
    },
  ];

  const tableDefMap = new Map(tableDefs.map((table) => [table.name, table]));

  db.exec("BEGIN");

  try {
    for (const tableName of tablesMissingForeignKeys) {
      const table = tableDefMap.get(tableName);

      if (!table) {
        continue;
      }

      db.exec(table.ddl);
      db.exec(`INSERT INTO ${table.name}_new SELECT * FROM ${table.name}`);
      db.exec(`DROP TABLE ${table.name}`);
      db.exec(`ALTER TABLE ${table.name}_new RENAME TO ${table.name}`);

      for (const indexDdl of table.indexes) {
        db.exec(indexDdl);
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

  addForeignKeysToExistingTables(db);
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

function paginateClause(options = {}) {
  const { limit, offset } = options;
  if (limit == null) return { sql: "", params: [] };
  return { sql: " LIMIT ? OFFSET ?", params: [limit, offset ?? 0] };
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

export function listSessionRecords(userId = null, options = {}) {
  const db = getDatabase();
  const { sql: pageSql, params: pageParams } = paginateClause(options);

  if (userId != null) {
    return db
      .prepare(
        `SELECT * FROM sessions WHERE deletedAt IS NULL AND userId = ? ORDER BY updatedAt DESC${pageSql}`,
      )
      .all(userId, ...pageParams)
      .map(sessionRowToRecord)
      .filter(Boolean);
  }

  return db
    .prepare(
      `SELECT * FROM sessions WHERE deletedAt IS NULL ORDER BY updatedAt DESC${pageSql}`,
    )
    .all(...pageParams)
    .map(sessionRowToRecord)
    .filter(Boolean);
}

export function listSessionRecordsWithCount(userId = null, options = {}) {
  const db = getDatabase();
  const { limit, offset } = options;
  const countRow = userId != null
    ? db.prepare(`SELECT COUNT(*) AS count FROM sessions WHERE deletedAt IS NULL AND userId = ?`).get(userId)
    : db.prepare(`SELECT COUNT(*) AS count FROM sessions WHERE deletedAt IS NULL`).get();
  const total = Number(countRow?.count ?? 0);

  if (limit != null) {
    const whereClause = userId != null
      ? `WHERE deletedAt IS NULL AND userId = ?`
      : `WHERE deletedAt IS NULL`;
    const params = userId != null ? [userId, limit, offset ?? 0] : [limit, offset ?? 0];

    const rows = db.prepare(`
      SELECT *, COUNT(*) OVER() AS _total
      FROM sessions ${whereClause}
      ORDER BY updatedAt DESC
      LIMIT ? OFFSET ?
    `).all(...params);

    const total = rows.length > 0 ? rows[0]._total : 0;
    const sessions = rows.map((row) => {
      const { _total, ...rest } = row;
      return sessionRowToRecord(rest);
    }).filter(Boolean);
    return { sessions, total };
  }

  const sessions = listSessionRecords(userId);
  return { sessions, total };
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

const SHA1_PATTERN = /^[a-f0-9]{40}$/i;

function isSha1(value) {
  return SHA1_PATTERN.test(`${value ?? ""}`.trim());
}

function normalizeLegacyBlockRow(row) {
  if (!row || row.blockType !== "dialogue") {
    return row;
  }

  const isLegacyShiftedRow = !isSha1(row.parentBlockSHA1) && isSha1(row.contextLength);

  if (!isLegacyShiftedRow) {
    return row;
  }

  return {
    ...row,
    reasoning: row.meta ?? "",
    tokenUsage: row.reasoning ?? "{}",
    contextLength: row.tokenUsage ?? 0,
    parentBlockSHA1: row.contextLength ?? null,
    flags: row.parentBlockSHA1 ?? "{}",
    meta: row.flags ?? "{}",
  };
}

export function blockRowToRecord(row) {
  if (!row) {
    return null;
  }

  const normalizedRow = normalizeLegacyBlockRow(row);

  const parentBlockSHA1 = normalizedRow.parentBlockSHA1 && isSha1(normalizedRow.parentBlockSHA1)
    ? normalizedRow.parentBlockSHA1
    : null;

  return {
    sha1: normalizedRow.sha1,
    sessionHash: normalizedRow.sessionHash,
    blockType: normalizedRow.blockType,
    createdAt: normalizedRow.createdAt,
    modelAlias: normalizedRow.modelAlias,
    prompt: parseMaybeContent(normalizedRow.prompt),
    response: parseMaybeContent(normalizedRow.response),
    reasoning: parseMaybeContent(normalizedRow.reasoning ?? ""),
    tokenUsage: parseMaybeJson(normalizedRow.tokenUsage, {}),
    contextLength: Number(normalizedRow.contextLength ?? 0),
    parentBlockSHA1,
    flags: parseMaybeJson(normalizedRow.flags, {}),
    meta: parseMaybeJson(normalizedRow.meta, {}),
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

  try {
    return JSON.parse(value);
  } catch {
    return fallbackValue;
  }
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

export function listSummaryRecords(sessionHash, options = {}) {
  const db = getDatabase();
  const { sql: pageSql, params: pageParams } = paginateClause(options);

  return db
    .prepare(
      `SELECT * FROM summaries WHERE sessionHash = ? ORDER BY createdAt, blockSHA1${pageSql}`,
    )
    .all(sessionHash, ...pageParams)
    .map(summaryRowToRecord);
}

export function listSummaryRecordsWithCount(sessionHash, options = {}) {
  const db = getDatabase();
  const { limit, offset } = options;
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM summaries WHERE sessionHash = ?`).get(sessionHash);
  const total = Number(countRow?.count ?? 0);

  if (limit != null) {
    const rows = db.prepare(`
      SELECT *, COUNT(*) OVER() AS _total
      FROM summaries WHERE sessionHash = ?
      ORDER BY createdAt, blockSHA1
      LIMIT ? OFFSET ?
    `).all(sessionHash, limit, offset ?? 0);

    const total = rows.length > 0 ? rows[0]._total : 0;
    const summaries = rows.map((row) => {
      const { _total, ...rest } = row;
      return summaryRowToRecord(rest);
    });
    return { summaries, total };
  }

  const summaries = listSummaryRecords(sessionHash);
  return { summaries, total };
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

export function listErrorRecords(sessionHash, options = {}) {
  const db = getDatabase();
  const { sql: pageSql, params: pageParams } = paginateClause(options);

  return db
    .prepare(
      `SELECT * FROM errors WHERE sessionHash = ? ORDER BY createdAt DESC, logId DESC${pageSql}`,
    )
    .all(sessionHash, ...pageParams)
    .map(errorRowToRecord);
}

export function countErrorRecords(sessionHash) {
  const db = getDatabase();
  const result = db.prepare(`SELECT COUNT(*) AS count FROM errors WHERE sessionHash = ?`).get(sessionHash);
  return result.count;
}

export function listErrorRecordsWithCount(sessionHash, options = {}) {
  const db = getDatabase();
  const { limit, offset } = options;
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM errors WHERE sessionHash = ?`).get(sessionHash);
  const total = Number(countRow?.count ?? 0);

  if (limit != null) {
    const rows = db.prepare(`
      SELECT *, COUNT(*) OVER() AS _total
      FROM errors WHERE sessionHash = ?
      ORDER BY createdAt DESC, logId DESC
      LIMIT ? OFFSET ?
    `).all(sessionHash, limit, offset ?? 0);

    const total = rows.length > 0 ? rows[0]._total : 0;
    const errors = rows.map((row) => {
      const { _total, ...rest } = row;
      return errorRowToRecord(rest);
    });
    return { errors, total };
  }

  const rows = db.prepare(`
    SELECT * FROM errors WHERE sessionHash = ?
    ORDER BY createdAt DESC, logId DESC
  `).all(sessionHash);
  const errors = rows.map(errorRowToRecord);
  return { errors, total };
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

export function listAdaptationRecords(sessionHash, options = {}) {
  const db = getDatabase();
  const { sql: pageSql, params: pageParams } = paginateClause(options);

  return db
    .prepare(
      `SELECT * FROM adaptations WHERE sessionHash = ? ORDER BY blockSHA1, key${pageSql}`,
    )
    .all(sessionHash, ...pageParams)
    .map(adaptationRowToRecord);
}

export function listAdaptationRecordsWithCount(sessionHash, options = {}) {
  const db = getDatabase();
  const { limit, offset } = options;
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM adaptations WHERE sessionHash = ?`).get(sessionHash);
  const total = Number(countRow?.count ?? 0);

  if (limit != null) {
    const rows = db.prepare(`
      SELECT *, COUNT(*) OVER() AS _total
      FROM adaptations WHERE sessionHash = ?
      ORDER BY blockSHA1, key
      LIMIT ? OFFSET ?
    `).all(sessionHash, limit, offset ?? 0);

    const total = rows.length > 0 ? rows[0]._total : 0;
    const adaptations = rows.map((row) => {
      const { _total, ...rest } = row;
      return adaptationRowToRecord(rest);
    });
    return { adaptations, total };
  }

  const adaptations = listAdaptationRecords(sessionHash);
  return { adaptations, total };
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