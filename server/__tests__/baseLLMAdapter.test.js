import { describe, expect, it } from "vitest";
import { BaseLLMAdapter } from "../services/providerAdapters/baseLLMAdapter.js";
import { registerTool } from "../services/tools/toolRegistry.js";

class FakeAdapter extends BaseLLMAdapter {
  constructor(results) {
    super({ providerType: "test", supportsMultimodal: true }, { apiKey: "test" });
    this.results = results;
    this.requests = [];
  }

  async doCallWithTools(messages) {
    this.requests.push(messages);
    return this.results[this.requests.length - 1];
  }
}

describe("BaseLLMAdapter TikZ tool state", () => {
  it("keeps one artifact, validates the check target, and does not claim visual verification", async () => {
    const tikzCode = "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}";
    const definitions = [
      { type: "function", function: { name: "draw_tikz", parameters: { type: "object" } } },
      { type: "function", function: { name: "check_drawing", parameters: { type: "object" } } },
    ];

    registerTool({
      definition: definitions[0],
      execute: async () => ({
        toolResult: { artifactId: "artifact-1", tikzCode, compiled: true },
        artifacts: [{
          id: "artifact-1",
          type: "image",
          mime: "image/png",
          contextPolicy: "preserve",
          data: "cGRhdGE=",
          meta: { svg: "<svg />" },
        }],
      }),
    });
    registerTool({
      definition: definitions[1],
      execute: async (args) => ({ toolResult: { ...args }, artifacts: [] }),
    });

    const adapter = new FakeAdapter([
      {
        reply: "",
        reasoning: "",
        usage: { input: 1, output: 1, total: 2 },
        toolCalls: [{
          id: "call-draw",
          function: { name: "draw_tikz", arguments: JSON.stringify({ tikzCode }) },
        }],
        message: { role: "assistant", content: null, tool_calls: [] },
      },
      {
        reply: "",
        reasoning: "",
        usage: { input: 1, output: 1, total: 2 },
        toolCalls: [{
          id: "call-check",
          function: {
            name: "check_drawing",
            arguments: JSON.stringify({ artifactId: "artifact-1" }),
          },
        }],
        message: { role: "assistant", content: null, tool_calls: [] },
      },
      {
        reply: "完成",
        reasoning: "",
        usage: { input: 1, output: 1, total: 2 },
        toolCalls: [],
      },
    ]);

    const result = await adapter.callWithTools({
      messages: [{ role: "user", content: "draw" }],
      tools: definitions,
    });

    expect(result.reply).toBe("完成");
    expect(result.tikzInfo).toMatchObject({
      artifactId: "artifact-1",
      compiled: true,
      checked: true,
      verified: false,
      verificationStatus: "image_available_for_model_review",
    });
    expect(result.preservedArtifacts).toHaveLength(1);
    expect(result.preservedArtifacts[0].meta).toBeUndefined();

    const secondRoundMessages = adapter.requests[1];
    expect(secondRoundMessages.some((message) => message.tool_name === "draw_tikz")).toBe(true);
    expect(secondRoundMessages.some((message) => message.content?.[1]?.type === "image_url")).toBe(true);
  });
});
