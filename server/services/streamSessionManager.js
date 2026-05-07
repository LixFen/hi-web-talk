const STREAM_SESSION_TTL = 300000; // 5 minutes after completion

class StreamSession {
  constructor(sessionHash) {
    this.sessionHash = sessionHash;
    this.events = [];
    this.subscribers = new Set();
    this.completed = false;
    this.completedAt = 0;
    this.finalDetail = null;
    this.finalError = null;
  }

  pushEvent(event) {
    this.events.push(event);
    this._broadcast(event);
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  complete(detail) {
    this.completed = true;
    this.completedAt = Date.now();
    this.finalDetail = detail;
  }

  fail(error) {
    this.completed = true;
    this.completedAt = Date.now();
    this.finalError = error;
    const errorEvent = { type: "error", error: error instanceof Error ? error.message : String(error) };
    this.events.push(errorEvent);
    this._broadcast(errorEvent);
  }

  _broadcast(event) {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // subscriber error should not break other subscribers
      }
    }
  }
}

class StreamSessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupTimer = null;
  }

  create(sessionHash) {
    const existing = this.sessions.get(sessionHash);
    if (existing) {
      existing.subscribers.clear();
      existing.complete(null);
    }
    this.sessions.delete(sessionHash);

    const session = new StreamSession(sessionHash);
    this.sessions.set(sessionHash, session);
    return session;
  }

  get(sessionHash) {
    const session = this.sessions.get(sessionHash);
    if (!session) {
      return null;
    }

    if (session.completed) {
      const elapsed = Date.now() - session.completedAt;
      if (elapsed > STREAM_SESSION_TTL) {
        this.sessions.delete(sessionHash);
        return null;
      }
    }

    return session;
  }

  remove(sessionHash) {
    this.sessions.delete(sessionHash);
  }

  startCleanupTimer() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, session] of this.sessions) {
        if (session.completed && (now - session.completedAt) > STREAM_SESSION_TTL) {
          this.sessions.delete(key);
        }
      }
    }, 60000).unref();
  }
}

export const streamSessionManager = new StreamSessionManager();
