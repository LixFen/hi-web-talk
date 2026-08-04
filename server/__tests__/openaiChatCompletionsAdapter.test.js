import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options) {
      this.options = options;
      this.chat = { completions: { create: mockCreate } };
    }
  },
}));

import { createOpenAIChatCompletionsAdapter } from "../services/providerAdapters/openaiChatCompletionsAdapter.js";

function makeAdapter(overrides = {}) {
  return createOpenAIChatCompletionsAdapter({
    modelName: "reasoning-model",
    providerType: "openai-chat-completions",
    supportsThinking: true,
    requestOptions: { reasoningEffort: "high" },
    ...overrides,
  }, { apiKey: "test-key" });
}

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    id: "chatcmpl_1",
    choices: [{ message: { content: "OK" } }],
    usage: {},
  });
});

describe("OpenAI Chat Completions adapter", () => {
  it("sends reasoning_effort for a generic chat-compatible model", async () => {
    await makeAdapter().call({ messages: [{ role: "user", content: "test" }] });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      model: "reasoning-model",
      reasoning_effort: "high",
    });
  });

  it("does not send reasoning_effort when the effort is empty", async () => {
    await makeAdapter({ requestOptions: { reasoningEffort: "" } }).call({
      messages: [{ role: "user", content: "test" }],
    });

    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");
  });

  it("prioritizes an explicit no-thinking parameter over reasoning_effort", async () => {
    await makeAdapter({
      thinkingDisable: { param: "enable_thinking", value: false },
    }).call({ messages: [{ role: "user", content: "test" }] });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({ enable_thinking: false });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");
  });
});
