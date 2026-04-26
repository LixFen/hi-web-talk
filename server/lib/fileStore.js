import fs from "fs/promises";
import path from "path";

const writeLockStateByFilePath = new Map();

async function withFileWriteLock(filePath, action) {
  let lockState = writeLockStateByFilePath.get(filePath);

  if (!lockState) {
    lockState = {
      locked: false,
      waiters: [],
    };
    writeLockStateByFilePath.set(filePath, lockState);
  }

  if (lockState.locked) {
    await new Promise((resolve) => {
      lockState.waiters.push(resolve);
    });
  }

  lockState.locked = true;

  try {
    return await action();
  } finally {
    const nextWaiter = lockState.waiters.shift();

    if (nextWaiter) {
      nextWaiter();
    } else {
      lockState.locked = false;
      writeLockStateByFilePath.delete(filePath);
    }
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath, fallbackValue = null) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

export async function writeJson(filePath, value) {
  await withFileWriteLock(filePath, async () => {
    await ensureDir(path.dirname(filePath));

    const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const backupFilePath = `${filePath}.bak`;
    const content = `${JSON.stringify(value, null, 2)}\n`;

    await fs.writeFile(tempFilePath, content, "utf8");

    // On Windows, rename cannot replace an existing file.
    // Move current file to backup first so a crash does not lose both copies.
    await fs.rm(backupFilePath, { force: true });
    let hasBackup = false;

    if (await pathExists(filePath)) {
      try {
        await fs.rename(filePath, backupFilePath);
        hasBackup = true;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }

    try {
      await fs.rename(tempFilePath, filePath);
      if (hasBackup) {
        await fs.rm(backupFilePath, { force: true });
      }
    } catch (error) {
      if (hasBackup && !(await pathExists(filePath)) && (await pathExists(backupFilePath))) {
        await fs.rename(backupFilePath, filePath);
      }

      throw error;
    }
  });
}

export async function listDirectories(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
