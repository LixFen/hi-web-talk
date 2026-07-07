import { describe, it, expect } from "vitest";
import { inferModelCapabilities, getSnapshotInfo } from "../services/modelCapabilities.js";

describe("inferModelCapabilities", () => {
  it("should return null for empty input", () => {
    expect(inferModelCapabilities("")).toBeNull();
    expect(inferModelCapabilities(null)).toBeNull();
    expect(inferModelCapabilities(undefined)).toBeNull();
  });

  it("should return null for unknown model", () => {
    expect(inferModelCapabilities("completely-unknown-model-xyz-2025")).toBeNull();
  });

  // "doubao-1.5-thinking-pro" 在生成的精确匹配表中存在（supportsMultimodal: false）
  it("should return capabilities for known exact-match model", () => {
    const caps = inferModelCapabilities("doubao-1.5-thinking-pro");
    expect(caps).not.toBeNull();
    expect(caps.supportsThinking).toBe(true);
    expect(caps.maxContext).toBe(128000);
  });

  it("should handle case-insensitive model names (exact match)", () => {
    const caps = inferModelCapabilities("DOUBAO-1.5-THINKING-PRO");
    expect(caps).not.toBeNull();
    expect(caps.supportsThinking).toBe(true);
  });

  // 测试 MANUAL_OVERRIDES：用不在精确/前缀匹配表中的模型名触发兜底
  it("should fall back to MANUAL_OVERRIDES: doubao-1.5-thinking", () => {
    const caps = inferModelCapabilities("zzz-doubao-1.5-thinking-test");
    expect(caps).not.toBeNull();
    expect(caps.supportsMultimodal).toBe(true);
    expect(caps.supportsThinking).toBe(true);
    expect(caps.maxContext).toBe(128000);
  });

  it("should fall back to MANUAL_OVERRIDES: doubao-1.5-vision", () => {
    const caps = inferModelCapabilities("test-mm-doubao-vision-model");
    expect(caps).not.toBeNull();
    expect(caps.supportsMultimodal).toBe(true);
    expect(caps.supportsThinking).toBe(false);
  });

  it("should return formatted result with default false for missing fields", () => {
    // MANUAL_OVERRIDES 的 "doubao" 行没有 toolUse => 应默认 false
    const caps = inferModelCapabilities("zzz-doubao-test-model");
    expect(caps).not.toBeNull();
    expect(caps.toolUse).toBe(false);
  });
});

describe("getSnapshotInfo", () => {
  it("should return an object with generatedAt", () => {
    const info = getSnapshotInfo();
    expect(info).toHaveProperty("generatedAt");
  });
});
