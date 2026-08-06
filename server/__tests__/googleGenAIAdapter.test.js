import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateContent = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    constructor() {
      this.models = { generateContent: mockGenerateContent };
    }
  },
}));

import { createGoogleGenAIAdapter } from "../services/providerAdapters/googleGenAIAdapter.js";

const toolName = "google_adapter_test_tool";

describe("Google tool result adaptation", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContent
      .mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ functionCall: { name: toolName, args: { value: 1 } } }] } }],
        usageMetadata: {},
      })
      .mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ text: "done" }] } }],
        usageMetadata: {},
      });
  });

  it("preserves the function name in functionResponse", async () => {
    const adapter = createGoogleGenAIAdapter(
      {
        modelName: "gemini-test",
        providerType: "google-generative-ai",
        supportsThinking: false,
      },
      { apiKey: "test-key" },
    );

    const result = await adapter.callWithTools({
      messages: [{ role: "user", content: "use a tool" }],
      tools: [{ type: "function", function: { name: toolName, parameters: { type: "object" } } }],
      onToolEvent: undefined,
    });

    const secondRequest = mockGenerateContent.mock.calls[1][0];
    const functionResponsePart = secondRequest.contents
      .flatMap((content) => content.parts ?? [])
      .find((part) => part.functionResponse);

    expect(functionResponsePart.functionResponse.name).toBe(toolName);
    expect(result.reply).toBe("done");
  });
});
