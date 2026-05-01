import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "../constants.js";
import { ensureDir, pathExists } from "../lib/fileStore.js";
import { getDatabase } from "../lib/database.js";

const ATTACHMENTS_DIR = path.join(DATA_DIR, "attachments");

function getAttachmentDir(sessionHash) {
  return path.join(ATTACHMENTS_DIR, sessionHash);
}

function getAttachmentPath(sessionHash, attachmentId) {
  return path.join(getAttachmentDir(sessionHash), `${attachmentId}.enc`);
}

function getEncryptionKey() {
  const secret = process.env.ATTACHMENT_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET;
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptBuffer(plainBuffer) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptBuffer(encryptedBuffer) {
  const key = getEncryptionKey();
  const iv = encryptedBuffer.slice(0, 12);
  const tag = encryptedBuffer.slice(12, 28);
  const encrypted = encryptedBuffer.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export async function saveAttachment(sessionHash, blockSHA1, fileName, mimeType, buffer) {
  const attachmentId = crypto.randomUUID();
  const dir = getAttachmentDir(sessionHash);
  await ensureDir(dir);

  const encrypted = encryptBuffer(buffer);
  const filePath = getAttachmentPath(sessionHash, attachmentId);
  await fs.writeFile(filePath, encrypted);

  const db = getDatabase();
  db.prepare(`
    INSERT INTO attachments (attachmentId, sessionHash, blockSHA1, fileName, mimeType, size, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(attachmentId, sessionHash, blockSHA1 ?? null, fileName, mimeType, buffer.length, new Date().toISOString());

  return {
    attachmentId,
    sessionHash,
    blockSHA1: blockSHA1 ?? null,
    fileName,
    mimeType,
    size: buffer.length,
  };
}

export async function readAttachment(attachmentId) {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM attachments WHERE attachmentId = ?`).get(attachmentId);

  if (!row) {
    return null;
  }

  const filePath = getAttachmentPath(row.sessionHash, attachmentId);

  if (!(await pathExists(filePath))) {
    return null;
  }

  const encrypted = await fs.readFile(filePath);
  const decrypted = decryptBuffer(encrypted);

  return {
    attachmentId: row.attachmentId,
    sessionHash: row.sessionHash,
    blockSHA1: row.blockSHA1,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.size,
    buffer: decrypted,
  };
}

export async function listAttachments(sessionHash, blockSHA1 = null) {
  const db = getDatabase();

  if (blockSHA1) {
    const rows = db.prepare(`
      SELECT attachmentId, sessionHash, blockSHA1, fileName, mimeType, size, createdAt
      FROM attachments WHERE sessionHash = ? AND blockSHA1 = ? ORDER BY createdAt
    `).all(sessionHash, blockSHA1);
    return rows;
  }

  const rows = db.prepare(`
    SELECT attachmentId, sessionHash, blockSHA1, fileName, mimeType, size, createdAt
    FROM attachments WHERE sessionHash = ? ORDER BY createdAt
  `).all(sessionHash);
  return rows;
}

export async function deleteAttachments(sessionHash, attachmentIds = []) {
  const db = getDatabase();

  for (const attachmentId of attachmentIds) {
    const filePath = getAttachmentPath(sessionHash, attachmentId);
    try {
      await fs.rm(filePath, { force: true });
    } catch {
      // ignore
    }
  }

  if (attachmentIds.length > 0) {
    const placeholders = attachmentIds.map(() => "?").join(", ");
    db.prepare(`DELETE FROM attachments WHERE sessionHash = ? AND attachmentId IN (${placeholders})`).run(
      sessionHash,
      ...attachmentIds,
    );
  }
}

export async function deleteAttachmentsForBlocks(sessionHash, blockSHA1s = []) {
  const db = getDatabase();

  if (blockSHA1s.length > 0) {
    const placeholders = blockSHA1s.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT attachmentId FROM attachments WHERE sessionHash = ? AND blockSHA1 IN (${placeholders})
    `).all(sessionHash, ...blockSHA1s);

    const attachmentIds = rows.map((row) => row.attachmentId);
    await deleteAttachments(sessionHash, attachmentIds);
  }
}

export async function updateAttachmentBlockSHA1(sessionHash, attachmentId, blockSHA1) {
  const db = getDatabase();
  db.prepare(`
    UPDATE attachments SET blockSHA1 = ? WHERE sessionHash = ? AND attachmentId = ?
  `).run(blockSHA1, sessionHash, attachmentId);
}
