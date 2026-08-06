import { describe, expect, it } from "vitest";
import { getToolDefinitions, registerTool } from "../services/tools/toolRegistry.js";

describe("toolRegistry", () => {
  it("can expose an explicit tool subset", () => {
    const firstName = "registry_test_first";
    const secondName = "registry_test_second";
    const execute = async () => ({ toolResult: { ok: true }, artifacts: [] });

    registerTool({
      definition: { type: "function", function: { name: firstName, parameters: { type: "object" } } },
      execute,
    });
    registerTool({
      definition: { type: "function", function: { name: secondName, parameters: { type: "object" } } },
      execute,
    });

    expect(getToolDefinitions([secondName])).toEqual([
      { type: "function", function: { name: secondName, parameters: { type: "object" } } },
    ]);
  });
});
