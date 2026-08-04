import { describe, expect, it } from "vitest";
import { StreamSessionManager } from "../services/streamSessionManager.js";

const SESSION = "a".repeat(24);
const OTHER_SESSION = "b".repeat(24);
const OPERATION = "11111111-1111-4111-8111-111111111111";
const OTHER_OPERATION = "22222222-2222-4222-8222-222222222222";

describe("StreamSessionManager", () => {
  it("keeps a repeated operation id attached to its original task", () => {
    const manager = new StreamSessionManager();
    const first = manager.create(SESSION, OPERATION);
    const repeated = manager.create(SESSION, OPERATION);

    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(repeated.session).toBe(first.session);
    expect(() => manager.create(OTHER_SESSION, OPERATION)).toThrow(/operationId/);
  });

  it("rejects a different concurrent operation in the same session", () => {
    const manager = new StreamSessionManager();
    manager.create(SESSION, OPERATION);

    expect(() => manager.create(SESSION, OTHER_OPERATION)).toThrow(/正在进行/);
  });

  it("discovers only the current active session when no operation id is provided", () => {
    const manager = new StreamSessionManager();
    const { session } = manager.create(SESSION, OPERATION);

    expect(manager.getForReconnect(SESSION)).toBe(session);
    session.complete({});
    manager.finish(session);
    expect(manager.getForReconnect(SESSION)).toBeNull();
    expect(manager.create(SESSION, OTHER_OPERATION).created).toBe(true);
  });

  it("recovers a completed operation only when its exact operation id is provided", () => {
    const manager = new StreamSessionManager();
    const { session } = manager.create(SESSION, OPERATION);
    const detail = { messages: [{ content: "done" }] };
    session.pushEvent({ type: "complete", detail });
    session.complete(detail);
    manager.finish(session);

    expect(manager.getForReconnect(SESSION, OPERATION)).toBe(session);
    expect(manager.getForReconnect(SESSION, OPERATION).events).toEqual([
      { type: "complete", detail, operationId: OPERATION },
    ]);
    expect(manager.getForReconnect(SESSION)).toBeNull();
  });

  it("cancels the matching operation without affecting another session", () => {
    const manager = new StreamSessionManager();
    const { session } = manager.create(SESSION, OPERATION);

    expect(manager.cancel(OTHER_SESSION, OPERATION)).toBe(false);
    expect(session.abortController.signal.aborted).toBe(false);
    expect(manager.cancel(SESSION, OPERATION)).toBe(true);
    expect(session.abortController.signal.aborted).toBe(true);
  });
});
