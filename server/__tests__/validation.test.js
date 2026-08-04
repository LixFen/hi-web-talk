import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  blockReplySchema,
  blockReplyStreamWithOperationSchema,
  sessionUpdateSchema,
  providerCreateSchema,
  providerUpdateSchema,
  modelCreateSchema,
  pathSessionHashSchema,
  pathBlockSHA1Schema,
  pathProviderIdSchema,
  paginationQuerySchema,
  attachmentUploadSchema,
  streamCancellationQuerySchema,
  streamOperationQuerySchema,
} from "../lib/validation.js";

describe("registerSchema", () => {
  it("should accept valid input", () => {
    const result = registerSchema.safeParse({ username: "testuser", password: "1234" });
    expect(result.success).toBe(true);
  });

  it("should reject short username", () => {
    const result = registerSchema.safeParse({ username: "a", password: "1234" });
    expect(result.success).toBe(false);
  });

  it("should reject short password", () => {
    const result = registerSchema.safeParse({ username: "testuser", password: "12" });
    expect(result.success).toBe(false);
  });

  it("should trim username", () => {
    const result = registerSchema.safeParse({ username: "  user  ", password: "1234" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.username).toBe("user");
  });

  it("should accept inviteCode option", () => {
    const result = registerSchema.safeParse({ username: "testuser", password: "1234", inviteCode: "abc" });
    expect(result.success).toBe(true);
  });
});

describe("loginSchema", () => {
  it("should accept valid input", () => {
    const result = loginSchema.safeParse({ username: "user", password: "pass" });
    expect(result.success).toBe(true);
  });

  it("should reject empty username", () => {
    const result = loginSchema.safeParse({ username: "", password: "pass" });
    expect(result.success).toBe(false);
  });

  it("should reject empty password", () => {
    const result = loginSchema.safeParse({ username: "user", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("should accept valid input", () => {
    const result = changePasswordSchema.safeParse({ oldPassword: "old", newPassword: "new1234" });
    expect(result.success).toBe(true);
  });

  it("should reject short newPassword", () => {
    const result = changePasswordSchema.safeParse({ oldPassword: "old", newPassword: "12" });
    expect(result.success).toBe(false);
  });
});

describe("blockReplySchema", () => {
  it("should accept string prompt", () => {
    const result = blockReplySchema.safeParse({
      sessionHash: "abc123def456abc123def456",
      prompt: "hello",
    });
    expect(result.success).toBe(true);
  });

  it("should accept array prompt", () => {
    const result = blockReplySchema.safeParse({
      sessionHash: "abc123def456abc123def456",
      prompt: [{ type: "text", text: "hello" }],
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty sessionHash", () => {
    const result = blockReplySchema.safeParse({
      sessionHash: "",
      prompt: "hello",
    });
    expect(result.success).toBe(false);
  });

  it("should accept optional fields", () => {
    const result = blockReplySchema.safeParse({
      sessionHash: "abc123def456abc123def456",
      prompt: "hi",
      modelAlias: "gpt-4",
      searchMode: "auto",
    });
    expect(result.success).toBe(true);
  });
});

describe("stream operation schemas", () => {
  const operationId = "550e8400-e29b-41d4-a716-446655440000";

  it("requires an operation id for a streaming reply", () => {
    const result = blockReplyStreamWithOperationSchema.safeParse({
      sessionHash: "abc123def456abc123def456",
      prompt: "hello",
      operationId,
    });
    expect(result.success).toBe(true);
    expect(blockReplyStreamWithOperationSchema.safeParse({
      sessionHash: "abc123def456abc123def456",
      prompt: "hello",
    }).success).toBe(false);
  });

  it("validates reconnect and cancellation identifiers", () => {
    expect(streamOperationQuerySchema.safeParse({ operationId }).success).toBe(true);
    expect(streamOperationQuerySchema.safeParse({}).success).toBe(true);
    expect(streamCancellationQuerySchema.safeParse({
      sessionHash: "a".repeat(24),
    }).success).toBe(true);
  });
});

describe("sessionUpdateSchema", () => {
  it("should accept valid title", () => {
    const result = sessionUpdateSchema.safeParse({ title: "New Title" });
    expect(result.success).toBe(true);
  });

  it("should reject empty title", () => {
    const result = sessionUpdateSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });
});

describe("providerCreateSchema", () => {
  it("should accept valid provider", () => {
    const result = providerCreateSchema.safeParse({
      slug: "my-provider",
      name: "My Provider",
      providerType: "openai-chat-completions",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid slug characters", () => {
    const result = providerCreateSchema.safeParse({
      slug: "My Provider!",
      name: "My Provider",
      providerType: "openai-chat-completions",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty name", () => {
    const result = providerCreateSchema.safeParse({
      slug: "my-provider",
      name: "",
      providerType: "openai-chat-completions",
    });
    expect(result.success).toBe(false);
  });
});

describe("providerUpdateSchema", () => {
  it("should allow partial update", () => {
    const result = providerUpdateSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });
});

describe("modelCreateSchema", () => {
  it("should require modelName", () => {
    const result = modelCreateSchema.safeParse({ modelName: "gpt-4" });
    expect(result.success).toBe(true);
  });

  it("should reject missing modelName", () => {
    const result = modelCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("pathSessionHashSchema", () => {
  it("should accept 24-char hex", () => {
    const result = pathSessionHashSchema.safeParse({ sessionHash: "a1b2c3d4e5f6a1b2c3d4e5f6" });
    expect(result.success).toBe(true);
  });

  it("should reject non-hex", () => {
    const result = pathSessionHashSchema.safeParse({ sessionHash: "zzzzzzzzzzzzzzzzzzzzzzzz" });
    expect(result.success).toBe(false);
  });

  it("should reject wrong length", () => {
    const result = pathSessionHashSchema.safeParse({ sessionHash: "abc" });
    expect(result.success).toBe(false);
  });
});

describe("pathBlockSHA1Schema", () => {
  it("should accept 40-char hex", () => {
    const result = pathBlockSHA1Schema.safeParse({ blockSHA1: "a".repeat(40) });
    expect(result.success).toBe(true);
  });

  it("should reject wrong length", () => {
    const result = pathBlockSHA1Schema.safeParse({ blockSHA1: "abc" });
    expect(result.success).toBe(false);
  });
});

describe("pathProviderIdSchema", () => {
  it("should accept valid UUID", () => {
    const result = pathProviderIdSchema.safeParse({ providerId: "550e8400-e29b-41d4-a716-446655440000" });
    expect(result.success).toBe(true);
  });

  it("should reject non-UUID", () => {
    const result = pathProviderIdSchema.safeParse({ providerId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("paginationQuerySchema", () => {
  it("should default page and pageSize", () => {
    const result = paginationQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("should coerce string numbers", () => {
    const result = paginationQuerySchema.safeParse({ page: "2", pageSize: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(10);
    }
  });

  it("should reject pageSize over 100", () => {
    const result = paginationQuerySchema.safeParse({ pageSize: "200" });
    expect(result.success).toBe(false);
  });
});

describe("attachmentUploadSchema", () => {
  it("should accept valid input", () => {
    const result = attachmentUploadSchema.safeParse({
      sessionHash: "abc123def456abc123def456",
      mimeType: "image/png",
      base64Data: "iVBORw0KGgo=",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty mimeType", () => {
    const result = attachmentUploadSchema.safeParse({
      sessionHash: "abc123def456abc123def456",
      mimeType: "",
      base64Data: "data",
    });
    expect(result.success).toBe(false);
  });
});
