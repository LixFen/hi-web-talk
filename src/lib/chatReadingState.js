export function buildReadableBlockOrder(messages = []) {
  const readableBlockSHA1s = [];
  const seenBlockSHA1s = new Set();

  for (const message of messages) {
    if (message?.role !== "assistant" || !message.blockSHA1) {
      continue;
    }

    if (seenBlockSHA1s.has(message.blockSHA1)) {
      continue;
    }

    seenBlockSHA1s.add(message.blockSHA1);
    readableBlockSHA1s.push(message.blockSHA1);
  }

  return readableBlockSHA1s;
}

export function getLatestReadableBlockSHA1(readableBlockSHA1s = [], preferredBlockSHA1 = "") {
  if (preferredBlockSHA1 && readableBlockSHA1s.includes(preferredBlockSHA1)) {
    return preferredBlockSHA1;
  }

  return readableBlockSHA1s[readableBlockSHA1s.length - 1] ?? "";
}

export function resolveReadCursor(
  readableBlockSHA1s = [],
  currentReadBlockSHA1 = "",
  fallbackBlockSHA1 = "",
) {
  if (readableBlockSHA1s.length === 0) {
    return "";
  }

  if (currentReadBlockSHA1 && readableBlockSHA1s.includes(currentReadBlockSHA1)) {
    return currentReadBlockSHA1;
  }

  return getLatestReadableBlockSHA1(readableBlockSHA1s, fallbackBlockSHA1);
}

export function pickLatestVisibleReadableBlock(
  visibleBlockSHA1s = [],
  readableBlockSHA1s = [],
) {
  if (visibleBlockSHA1s.length === 0 || readableBlockSHA1s.length === 0) {
    return "";
  }

  const visibleBlockSHA1Set = new Set(visibleBlockSHA1s);

  for (let index = readableBlockSHA1s.length - 1; index >= 0; index -= 1) {
    const blockSHA1 = readableBlockSHA1s[index];

    if (visibleBlockSHA1Set.has(blockSHA1)) {
      return blockSHA1;
    }
  }

  return "";
}

export function countUnreadBlocks(readableBlockSHA1s = [], lastReadBlockSHA1 = "") {
  if (readableBlockSHA1s.length === 0) {
    return 0;
  }

  const lastReadIndex = readableBlockSHA1s.indexOf(lastReadBlockSHA1);

  if (lastReadIndex === -1) {
    return readableBlockSHA1s.length;
  }

  return Math.max(readableBlockSHA1s.length - lastReadIndex - 1, 0);
}
