import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryCache } from "../lib/cache.js";

describe("MemoryCache", () => {
  let cache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MemoryCache(50); // short TTL for testing
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should store and retrieve a value", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("should return undefined for missing key", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("should expire entries after TTL", () => {
    cache.set("key1", "value1", 100);
    expect(cache.get("key1")).toBe("value1");

    vi.advanceTimersByTime(101);
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should use default TTL when not specified", () => {
    cache.set("key1", "value1");
    vi.advanceTimersByTime(51);
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should delete a key", () => {
    cache.set("key1", "value1");
    cache.delete("key1");
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should clear all entries", () => {
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("should clear entries by session prefix", () => {
    cache.set("abc123:block", "data1");
    cache.set("abc123:detail", "data2");
    cache.set("xyz789:block", "data3");

    cache.clearSession("abc123");
    expect(cache.get("abc123:block")).toBeUndefined();
    expect(cache.get("abc123:detail")).toBeUndefined();
    expect(cache.get("xyz789:block")).toBe("data3");
  });

  it("should handle delete on nonexistent key", () => {
    expect(() => cache.delete("ghost")).not.toThrow();
  });

  it("should return undefined for expired and then deleted entry", () => {
    cache.set("key1", "val");
    vi.advanceTimersByTime(100);
    // expired, get returns undefined
    expect(cache.get("key1")).toBeUndefined();
    // delete should not throw
    expect(() => cache.delete("key1")).not.toThrow();
  });
});
