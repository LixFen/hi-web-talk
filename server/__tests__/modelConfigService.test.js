import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProviderById, readJson } = vi.hoisted(() => ({
  getProviderById: vi.fn(),
  readJson: vi.fn(),
}));

const providerId = "fd5f9567-f7d5-498f-ab56-a6a344e9cc2c";

vi.mock("../services/providerConfigService.js", () => ({
  getProviderById,
}));

vi.mock("../lib/fileStore.js", () => ({
  ensureDir: vi.fn(),
  pathExists: vi.fn(async () => true),
  readJson,
  writeJson: vi.fn(),
}));

import { readStoredModels } from "../services/modelConfigService.js";

describe("modelConfigService provider inheritance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readJson.mockResolvedValue([
      {
        providerId,
        modelName: "third-party-model",
      },
    ]);
    getProviderById.mockImplementation(async (_providerId, userId) => (
      userId === 42
        ? {
            providerId,
            slug: "third-party",
            providerType: "anthropic-messages",
            baseURL: "https://example.com/anthropic",
            apiKeySource: "stored",
            apiKeyEnvName: "THIRD_PARTY_API_KEY",
            apiKeyEncrypted: "encrypted-key",
            systemPromptRole: "system",
            requestOptions: { thinkingEnabled: false },
          }
        : null
    ));
  });

  it("resolves a linked provider in the model owner's user scope", async () => {
    const [model] = await readStoredModels(42);

    expect(getProviderById).toHaveBeenCalledWith(providerId, 42);
    expect(model).toMatchObject({
      providerId,
      alias: "third-party:third-party-model",
      providerType: "anthropic-messages",
      baseURL: "https://example.com/anthropic",
      apiKeySource: "stored",
      apiKeyEncrypted: "encrypted-key",
    });
  });
});
