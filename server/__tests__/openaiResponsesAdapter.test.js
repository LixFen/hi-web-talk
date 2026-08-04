import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());
const mockOpenAIOptions = vi.hoisted(() => ({ current: null }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options) {
      this.options = options;
      mockOpenAIOptions.current = options;
      this.responses = { create: mockCreate };
    }
  },
}));

import {
  convertContentForResponses,
  createOpenAIResponsesAdapter,
} from "../services/providerAdapters/openaiResponsesAdapter.js";
import { normalizeResponsesBaseURL } from "../services/providerAdapters/responsesBaseURL.js";
import { registerTool } from "../services/tools/toolRegistry.js";

const modelConfig = {
  modelName: "gpt-5-mini",
  providerType: "openai-responses",
  supportsSystemRole: true,
  supportsThinking: true,
  supportsMultimodal: true,
  requestOptions: { reasoningEffort: "low" },
};

const toolName = "responses_adapter_test_tool";
const executeTool = vi.fn();

registerTool({
  definition: {
    type: "function",
    function: {
      name: toolName,
      description: "Test tool",
      parameters: { type: "object", properties: {} },
    },
  },
  execute: executeTool,
});

function makeAdapter() {
  return createOpenAIResponsesAdapter(modelConfig, { apiKey: "test-key" });
}

async function* streamFrom(events) {
  for (const event of events) yield event;
}

function messageOutput(text) {
  return [{
    type: "message",
    id: "msg_1",
    role: "assistant",
    content: [{ type: "output_text", text }],
    status: "completed",
  }];
}

beforeEach(() => {
  mockCreate.mockReset();
  mockOpenAIOptions.current = null;
  executeTool.mockReset();
  executeTool.mockResolvedValue({ toolResult: { ok: true }, artifacts: [] });
});

describe("OpenAI Responses adapter", () => {
  it("normalizes Responses base URLs with a single /v1 suffix", () => {
    expect(normalizeResponsesBaseURL("https://example.com")).toBe("https://example.com/v1");
    expect(normalizeResponsesBaseURL("https://example.com/")).toBe("https://example.com/v1");
    expect(normalizeResponsesBaseURL("https://example.com/v1")).toBe("https://example.com/v1");
    expect(normalizeResponsesBaseURL("https://example.com/v1/")).toBe("https://example.com/v1");
    expect(normalizeResponsesBaseURL("")).toBe("");
  });

  it("passes the normalized base URL to the Responses SDK", () => {
    createOpenAIResponsesAdapter(
      { ...modelConfig, baseURL: "https://example.com/" },
      { apiKey: "test-key" },
    );

    expect(mockOpenAIOptions.current).toMatchObject({
      apiKey: "test-key",
      baseURL: "https://example.com/v1",
    });
  });

  it("converts Responses input text and image blocks", () => {
    expect(convertContentForResponses([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc", detail: "high" } },
      { type: "input_file", file_id: "file_1" },
    ])).toEqual([
      { type: "input_text", text: "describe" },
      { type: "input_image", image_url: "data:image/png;base64,abc", detail: "high" },
      { type: "input_file", file_id: "file_1" },
    ]);
  });

  it("sends native Responses input and preserves reasoning output", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_1",
      output_text: "hello",
      output: messageOutput("hello"),
      usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
    });

    const controller = new AbortController();
    const result = await makeAdapter().call({
      signal: controller.signal,
      messages: [
        { role: "system", content: "system prompt" },
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          ],
        },
      ],
    });

    const [body, requestOptions] = mockCreate.mock.calls[0];
    expect(body).toMatchObject({
      model: "gpt-5-mini",
      stream: false,
      reasoning: { effort: "low" },
      input: [
        { role: "developer", content: "system prompt" },
        {
          role: "user",
          content: [
            { type: "input_text", text: "look" },
            { type: "input_image", image_url: "https://example.com/a.png" },
          ],
        },
      ],
    });
    expect(requestOptions).toEqual({ signal: controller.signal });
    expect(result).toMatchObject({ reply: "hello", responseId: "resp_1", usage: { total: 6 } });
  });

  it("continues multiple function calls with full output items and function_call_output", async () => {
    const firstOutput = [
      { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "plan" }] },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: toolName,
        arguments: '{"value":1}',
      },
      {
        type: "function_call",
        id: "fc_2",
        call_id: "call_2",
        name: toolName,
        arguments: '{"value":2}',
      },
    ];
    mockCreate
      .mockResolvedValueOnce({ id: "resp_1", output: firstOutput, output_text: "", usage: {} })
      .mockResolvedValueOnce({
        id: "resp_2",
        output: messageOutput("done"),
        output_text: "done",
        usage: {},
      });

    const result = await makeAdapter().callWithTools({
      messages: [{ role: "user", content: "run tools" }],
      tools: [{ type: "function", function: { name: toolName, parameters: { type: "object" } } }],
    });

    const secondBody = mockCreate.mock.calls[1][0];
    expect(secondBody.input.map((item) => item.type)).toEqual([
      undefined,
      "reasoning",
      "function_call",
      "function_call",
      "function_call_output",
      "function_call_output",
    ]);
    expect(secondBody.input.slice(-2)).toEqual([
      { type: "function_call_output", call_id: "call_1", output: '{"ok":true}' },
      { type: "function_call_output", call_id: "call_2", output: '{"ok":true}' },
    ]);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe("done");
    expect(result.reasoning[0].content).toBe("plan");
  });

  it("reconstructs streamed function-call arguments by output_index", async () => {
    const functionCall = {
      type: "function_call",
      id: "fc_stream_1",
      call_id: "call_stream_1",
      name: toolName,
      arguments: '{"value":3}',
      status: "completed",
    };
    const firstEvents = [
      { type: "response.created", response: { id: "resp_stream_1" } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "function_call", id: "fc_stream_1", call_id: "call_stream_1", name: toolName, arguments: "" },
      },
      { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_stream_1", delta: '{"value":' },
      { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_stream_1", delta: "3}" },
      {
        type: "response.function_call_arguments.done",
        output_index: 0,
        item_id: "fc_stream_1",
        name: toolName,
        arguments: '{"value":3}',
      },
      { type: "response.output_item.done", output_index: 0, item: functionCall },
      { type: "response.completed", response: { id: "resp_stream_1", output: [functionCall], usage: { total_tokens: 5 } } },
    ];
    const secondEvents = [
      { type: "response.output_text.delta", delta: "streamed" },
      {
        type: "response.reasoning_summary_part.added",
        part: { type: "summary_text", text: "checked" },
      },
      { type: "response.completed", response: { id: "resp_stream_2", output: messageOutput("streamed"), usage: { total_tokens: 7 } } },
    ];
    mockCreate.mockImplementation(async (body) => (
      body.stream ? streamFrom(body.input.some((item) => item.type === "function_call_output") ? secondEvents : firstEvents) : null
    ));

    const chunks = [];
    const result = await makeAdapter().streamWithTools({
      messages: [{ role: "user", content: "stream tools" }],
      tools: [{ type: "function", function: { name: toolName, parameters: { type: "object" } } }],
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(executeTool).toHaveBeenCalledWith({ value: 3 }, expect.anything());
    expect(mockCreate.mock.calls[1][0].input.slice(-1)).toEqual([
      { type: "function_call_output", call_id: "call_stream_1", output: '{"ok":true}' },
    ]);
    expect(result.reply).toBe("streamed");
    expect(result.responseId).toBe("resp_stream_2");
    expect(result.usage.total).toBe(12);
    expect(chunks).toEqual(expect.arrayContaining([
      { delta: "streamed" },
      { delta: "", reasoningDelta: "checked" },
    ]));
  });
});
