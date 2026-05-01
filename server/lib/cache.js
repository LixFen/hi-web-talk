class MemoryCache {
  constructor(defaultTTL = 20000) {
    this.store = new Map();
    this.defaultTTL = defaultTTL;
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) {
      return undefined;
    }
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return item.value;
  }

  set(key, value, ttl = this.defaultTTL) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  clearSession(sessionHash) {
    const prefix = `${sessionHash}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }
}

export const sessionDetailCache = new MemoryCache(20000);
