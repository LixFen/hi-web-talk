import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getModelByAlias,
  getProviderDefinitionByType,
  resolveModelCredential,
  getProviderById,
  resolveProviderCredential,
  getAdapter,
} = vi.hoisted(() => ({
  getModelByAlias: vi.fn(),
  getProviderDefinitionByType: vi.fn(),
  resolveModelCredential: vi.fn(),
  getProviderById: vi.fn(),
  resolveProviderCredential: vi.fn(),
  getAdapter: vi.fn(),
}));

vi.mock("../services/modelConfigService.js", () => ({
  getModelByAlias,
  getProviderDefinitionByType,
  resolveModelCredential,
}));

vi.mock("../services/providerConfigService.js", () => ({
  getProviderById,
  resolveProviderCredential,
}));

vi.mock("../services/providerAdapters/adapterFactory.js", () => ({
  getAdapter,
}));

import { testModelConnectivity } from "../services/modelConnectivityService.js";

describe("model connectivity service", () => {
  const adapter = { call: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    getAdapter.mockReturnValue(adapter);
    adapter.call.mockResolvedValue({ reply: "OK" });
    getProviderDefinitionByType.mockReturnValue({
      supportsSystemRole: true,
      supportsThinking: false,
      defaultSystemPromptRole: "system",
    });
    resolveModelCredential.mockResolvedValue({ apiKey: "key", configured: true });
    resolveProviderCredential.mockResolvedValue({ apiKey: "key", configured: true });
  });

  it("tests a saved model with the current form values", async () => {
    getModelByAlias.mockResolvedValue({
      alias: "openai:gpt-test",
      providerType: "openai-responses",
      baseURL: "https://example.com",
      apiKeySource: "env",
      apiKeyEnvName: "OPENAI_API_KEY",
      modelName: "old-model",
      requestOptions: { reasoningEffort: "low" },
    });

    const result = await testModelConnectivity({
      alias: "openai:gpt-test",
      providerId: "fd5f9567-f7d5-498f-ab56-a6a344e9cc2c",
      modelName: "new-model",
      requestOptions: { reasoningEffort: "high" },
    }, 42, "user");

    expect(result.ok).toBe(true);
    expect(getModelByAlias).toHaveBeenCalledWith("openai:gpt-test", 42, "user");
    expect(getAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        alias: "openai:gpt-test",
        modelName: "new-model",
        requestOptions: { reasoningEffort: "high" },
      }),
      { apiKey: "key", configured: true },
    );
    expect(adapter.call).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: "user", content: "Reply with exactly OK." }],
      signal: expect.any(AbortSignal),
    }));
  });

  it("tests a new model through its provider", async () => {
    const providerId = "fd5f9567-f7d5-498f-ab56-a6a344e9cc2c";
    getProviderById.mockResolvedValue({
      providerId,
      providerType: "openai-chat-completions",
      baseURL: "https://example.com/v1",
      apiKeySource: "stored",
      apiKeyEnvName: "OPENAI_API_KEY",
      apiKeyEncrypted: "encrypted",
      systemPromptRole: "system",
      requestOptions: {},
    });

    const result = await testModelConnectivity({
      providerId,
      modelName: "new-model",
    }, 42, "user");

    expect(result.ok).toBe(true);
    expect(getProviderById).toHaveBeenCalledWith(providerId, 42, "user");
    expect(resolveProviderCredential).toHaveBeenCalled();
    expect(getAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId,
        modelName: "new-model",
        baseURL: "https://example.com/v1",
      }),
      { apiKey: "key", configured: true },
    );
  });

  it("fails before making a provider request when credentials are missing", async () => {
    getModelByAlias.mockResolvedValue({
      alias: "openai:gpt-test",
      providerType: "openai-responses",
      modelName: "gpt-test",
      apiKeySource: "env",
      apiKeyEnvName: "OPENAI_API_KEY",
    });
    resolveModelCredential.mockResolvedValue({ apiKey: "", configured: false });

    await expect(testModelConnectivity({
      alias: "openai:gpt-test",
      modelName: "gpt-test",
    }, 42, "user")).rejects.toMatchObject({
      status: 400,
      message: "未配置OPENAI_API_KEY。",
    });
    expect(adapter.call).not.toHaveBeenCalled();
  });

  it("normalizes SDK abort errors into a connectivity timeout", async () => {
    getModelByAlias.mockResolvedValue({
      alias: "openai:gpt-test",
      providerType: "openai-responses",
      modelName: "gpt-test",
      apiKeySource: "env",
      apiKeyEnvName: "OPENAI_API_KEY",
    });
    adapter.call.mockRejectedValue(Object.assign(new Error("Request was aborted."), {
      name: "APIUserAbortError",
    }));

    await expect(testModelConnectivity({
      alias: "openai:gpt-test",
      modelName: "gpt-test",
    }, 42, "user")).rejects.toMatchObject({
      status: 504,
      message: "连接测试超时，请检查 Base URL、网络和模型名称。",
    });
  });
});
