const STREAM_SESSION_TTL = 300000;

export class StreamSession {
  constructor(sessionHash, operationId) {
    this.sessionHash = sessionHash;
    this.operationId = operationId;
    this.events = [];
    this.subscribers = new Set();
    this.completed = false;
    this.completedAt = 0;
    this.finalDetail = null;
    this.finalError = null;
    this.abortController = new AbortController();
  }

  pushEvent(event) {
    const withOperationId = { ...event, operationId: this.operationId };
    this.events.push(withOperationId);
    this._broadcast(withOperationId);
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
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
    this.pushEvent({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }

  cancel() {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  _broadcast(event) {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        // A disconnected subscriber must not affect the generation.
      }
    }
  }
}

export class StreamSessionManager {
  constructor() {
    this.sessionsByOperationId = new Map();
    this.activeOperationIdsBySession = new Map();
    this.cleanupTimer = null;
  }

  create(sessionHash, operationId) {
    const existing = this.sessionsByOperationId.get(operationId);
    if (existing) {
      if (existing.sessionHash !== sessionHash) {
        const error = new Error("operationId 已用于其他会话。");
        error.status = 409;
        throw error;
      }
      return { session: existing, created: false };
    }

    const activeOperationId = this.activeOperationIdsBySession.get(sessionHash);
    if (activeOperationId) {
      const error = new Error("该会话已有正在进行的回复。");
      error.status = 409;
      throw error;
    }

    const session = new StreamSession(sessionHash, operationId);
    this.sessionsByOperationId.set(operationId, session);
    this.activeOperationIdsBySession.set(sessionHash, operationId);
    return { session, created: true };
  }

  getForReconnect(sessionHash, operationId) {
    if (operationId) {
      const session = this.sessionsByOperationId.get(operationId);
      if (!session || session.sessionHash !== sessionHash) {
        return null;
      }
      if (session.completed && Date.now() - session.completedAt > STREAM_SESSION_TTL) {
        this.sessionsByOperationId.delete(operationId);
        return null;
      }
      return session;
    }

    const activeOperationId = this.activeOperationIdsBySession.get(sessionHash);
    const session = this.sessionsByOperationId.get(activeOperationId);
    return session && !session.completed ? session : null;
  }

  getActive(sessionHash, operationId) {
    const session = this.getForReconnect(sessionHash, operationId);
    return session && !session.completed ? session : null;
  }

  cancel(sessionHash, operationId) {
    const session = this.getActive(sessionHash, operationId);
    if (!session) return false;
    session.cancel();
    return true;
  }

  finish(session) {
    if (this.activeOperationIdsBySession.get(session.sessionHash) === session.operationId) {
      this.activeOperationIdsBySession.delete(session.sessionHash);
    }
  }

  startCleanupTimer() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [operationId, session] of this.sessionsByOperationId) {
        if (session.completed && now - session.completedAt > STREAM_SESSION_TTL) {
          this.sessionsByOperationId.delete(operationId);
        }
      }
    }, 60000).unref();
  }
}

export const streamSessionManager = new StreamSessionManager();
