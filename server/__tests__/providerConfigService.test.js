import { describe, expect, it } from "vitest";
import { normalizeProviderRecord } from "../services/providerConfigService.js";

describe("provider configuration", () => {
  it("adds /v1 to openai-responses provider URLs when missing", async () => {
    const provider = await normalizeProviderRecord({
      slug: "responses-provider",
      providerType: "openai-responses",
      baseURL: "https://example.com/",
    });

    expect(provider.baseURL).toBe("https://example.com/v1");
  });

  it("does not add /v1 to other provider types", async () => {
    const provider = await normalizeProviderRecord({
      slug: "chat-provider",
      providerType: "openai-chat-completions",
      baseURL: "https://example.com/",
    });

    expect(provider.baseURL).toBe("https://example.com/");
  });
});
