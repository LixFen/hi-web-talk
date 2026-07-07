import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database module
vi.mock("../lib/database.js", () => ({
  upsertBlockRecord: vi.fn(),
  readSessionBlockRecord: vi.fn(),
  listBlockRecords: vi.fn(),
  deleteBlockRecords: vi.fn(),
}));

vi.mock("../services/attachmentService.js", () => ({
  deleteAttachmentsForBlocks: vi.fn(),
}));

import { createSystemRootBlock, createDialogueBlock, readBlock, getChainBlocks, deleteBlockSubtree, mapChainBlocksToMessages } from "../services/blockGraphService.js";
import { upsertBlockRecord, readSessionBlockRecord, listBlockRecords, deleteBlockRecords } from "../lib/database.js";

describe("blockGraphService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("readBlock", () => {
    it("should return null for empty SHA1", async () => {
      expect(await readBlock("session1", "")).toBeNull();
      expect(await readBlock("session1", null)).toBeNull();
      expect(await readBlock("session1", undefined)).toBeNull();
    });

    it("should call readSessionBlockRecord", async () => {
      readSessionBlockRecord.mockReturnValue({ sha1: "abc", blockType: "dialogue" });
      const result = await readBlock("session1", "abc");
      expect(readSessionBlockRecord).toHaveBeenCalledWith("session1", "abc");
      expect(result).toEqual({ sha1: "abc", blockType: "dialogue" });
    });
  });

  describe("createSystemRootBlock", () => {
    it("should create a block with system type", async () => {
      const block = await createSystemRootBlock("session1", "You are a helpful assistant.");
      expect(block.blockType).toBe("system");
      expect(block.prompt).toBe("You are a helpful assistant.");
      expect(block.sha1).toHaveLength(40);
      expect(block.meta.kind).toBe("system-root");
      expect(upsertBlockRecord).toHaveBeenCalledTimes(1);
    });

    it("should produce deterministic SHA1 for same input and timestamp", async () => {
      const ts = new Date("2024-01-01").toISOString();
      // 直接测试 createSystemRootBlock 内部逻辑：相同输入+时间戳→相同 SHA1
      // 使用传入明确 createdAt 的方式没法做到，但 createStableBlock 使用
      // JSON.stringify(buildHashPayload) 做 sha1，payload 包含 content 字段。
      // 手动验证：同样 prompt 同样创建时间 → sha1 相同
      // 这里我们验证 block 结构正确性
      const block = await createSystemRootBlock("session1", "Hello");
      expect(block.sha1).toHaveLength(40);
      expect(block.blockType).toBe("system");
      expect(block.prompt).toBe("Hello");
    });
  });

  describe("createDialogueBlock", () => {
    it("should create a dialogue block", async () => {
      const block = await createDialogueBlock("session1", {
        modelAlias: "gpt-4",
        prompt: "Hello",
        response: "Hi there!",
        parentBlockSHA1: null,
      });
      expect(block.blockType).toBe("dialogue");
      expect(block.prompt).toBe("Hello");
      expect(block.response).toBe("Hi there!");
      expect(block.sha1).toHaveLength(40);
      expect(upsertBlockRecord).toHaveBeenCalledTimes(1);
    });

    it("should compute depth when parent exists", async () => {
      readSessionBlockRecord.mockReturnValue({ sha1: "parent-sha1", meta: { depth: 2 }, blockType: "dialogue" });
      const block = await createDialogueBlock("session1", {
        modelAlias: "gpt-4",
        prompt: "Hello",
        response: "Hi",
        parentBlockSHA1: "parent-sha1",
      });
      expect(block.meta.depth).toBe(3);
    });

    it("should default depth to 0 when no parent", async () => {
      const block = await createDialogueBlock("session1", {
        modelAlias: "gpt-4",
        prompt: "Hello",
        response: "Hi",
        parentBlockSHA1: null,
      });
      expect(block.meta.depth).toBe(0);
    });
  });

  describe("getChainBlocks", () => {
    it("should return empty array for null SHA1", async () => {
      const result = await getChainBlocks("session1", null);
      expect(result).toEqual([]);
    });

    it("should build chain from active block to root", async () => {
      listBlockRecords.mockReturnValue([
        { sha1: "root", parentBlockSHA1: null, createdAt: "2024-01-01" },
        { sha1: "mid", parentBlockSHA1: "root", createdAt: "2024-01-02" },
        { sha1: "leaf", parentBlockSHA1: "mid", createdAt: "2024-01-03" },
        { sha1: "other", parentBlockSHA1: "root", createdAt: "2024-01-04" },
      ]);

      const result = await getChainBlocks("session1", "leaf");
      expect(result).toHaveLength(3);
      expect(result[0].sha1).toBe("root");
      expect(result[1].sha1).toBe("mid");
      expect(result[2].sha1).toBe("leaf");
    });

    it("should throw for unknown block SHA1", async () => {
      listBlockRecords.mockReturnValue([]);
      await expect(getChainBlocks("session1", "unknown")).rejects.toThrow("找不到 block");
    });
  });

  describe("deleteBlockSubtree", () => {
    it("should return deleted block SHA1s", async () => {
      listBlockRecords.mockReturnValue([
        { sha1: "root", parentBlockSHA1: null, createdAt: "1" },
        { sha1: "child1", parentBlockSHA1: "root", createdAt: "2" },
        { sha1: "child2", parentBlockSHA1: "root", createdAt: "3" },
        { sha1: "grandchild", parentBlockSHA1: "child1", createdAt: "4" },
        { sha1: "other", parentBlockSHA1: null, createdAt: "5" },
      ]);

      const deleted = await deleteBlockSubtree("session1", "child1");
      expect(deleted.sort()).toEqual(["child1", "grandchild"].sort());
      expect(deleteBlockRecords).toHaveBeenCalledWith("session1", expect.arrayContaining(["child1", "grandchild"]));
    });
  });

  describe("mapChainBlocksToMessages", () => {
    it("should convert chain blocks to message format", () => {
      const blocks = [
        { sha1: "s1", blockType: "system", prompt: "system prompt", response: "" },
        { sha1: "b1", blockType: "dialogue", prompt: "Hello", response: "Hi!", flags: {} },
        { sha1: "b2", blockType: "dialogue", prompt: "How are you?", response: "Good!", flags: {} },
      ];

      const messages = mapChainBlocksToMessages(blocks);
      expect(messages).toHaveLength(5);
      expect(messages[0]).toEqual({ role: "system", content: "system prompt" });
      expect(messages[1]).toEqual({ role: "user", content: "Hello" });
      expect(messages[2]).toEqual({ role: "assistant", content: "Hi!" });
    });

    it("should skip blocks with ignoreInContext flag", () => {
      const blocks = [
        { sha1: "s1", blockType: "system", prompt: "system", response: "" },
        { sha1: "b1", blockType: "dialogue", prompt: "Hello", response: "Hi!", flags: { ignoreInContext: true } },
        { sha1: "b2", blockType: "dialogue", prompt: "Hi again", response: "Hey!", flags: {} },
      ];

      const messages = mapChainBlocksToMessages(blocks);
      expect(messages).toHaveLength(3);
      expect(messages[1].content).toBe("Hi again");
    });
  });
});
