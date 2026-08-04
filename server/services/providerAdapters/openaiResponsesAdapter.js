import OpenAI from "openai";
import { formatTokenUsage, mergeSystemIntoFirstUser } from "./baseAdapter.js";
import { BaseLLMAdapter } from "./baseLLMAdapter.js";
import { normalizeResponsesBaseURL } from "./responsesBaseURL.js";

function convertContentBlockForResponses(block) {
  if (typeof block === "string") {
    return { type: "input_text", text: block };
  }

  if (!block || typeof block !== "object") {
    return { type: "input_text", text: String(block ?? "") };
  }

  if (block.type === "text" || block.type === "input_text") {
    return { ...block, type: "input_text", text: block.text ?? "" };
  }

  if (block.type === "image_url" || block.type === "input_image") {
    const image = block.image_url;
    const imageUrl = typeof image === "string" ? image : image?.url ?? "";
    const detail = block.detail ?? (typeof image === "object" ? image?.detail : undefined);

    return {
      ...block,
      type: "input_image",
      image_url: imageUrl,
      ...(detail ? { detail } : {}),
    };
  }

  // Keep already-valid Responses content (for example input_file) and any
  // future content types that the SDK may add.
  return block;
}

export function convertContentForResponses(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return String(content ?? "");
  }

  return content.map(convertContentBlockForResponses);
}

function getResponseItems(message) {
  if (Array.isArray(message?.responseInputItems)) {
    return message.responseInputItems;
  }

  if (Array.isArray(message?.responseOutputItems)) {
    return message.responseOutputItems;
  }

  return null;
}

function getReasoningText(outputItems = []) {
  return outputItems
    .filter((item) => item?.type === "reasoning")
    .flatMap((item) => {
      if (Array.isArray(item.summary)) {
        return item.summary.map((part) => part?.text ?? String(part ?? ""));
      }

      if (item.summary != null) {
        return [String(item.summary)];
      }

      return item.text != null ? [String(item.text)] : [];
    })
    .filter(Boolean)
    .join("\n");
}

function getResponseText(result, outputItems = []) {
  if (result?.output_text != null && result.output_text !== "") {
    return String(result.output_text);
  }

  const outputText = outputItems
    .filter((item) => item?.type === "message")
    .flatMap((item) => {
      if (typeof item.content === "string") return [item.content];
      if (!Array.isArray(item.content)) return [];
      return item.content
        .filter((part) => (
          part?.type === "output_text" ||
          part?.type === "text" ||
          part?.type === "refusal"
        ))
        .map((part) => part.text ?? part.refusal ?? "");
    })
    .join("");

  return outputText || String(result?.output_text ?? "");
}

function getFunctionCallItems(outputItems = []) {
  return outputItems.filter((item) => item?.type === "function_call");
}

function normalizeToolCalls(functionCallItems) {
  return functionCallItems.map((item, index) => ({
    id: item.call_id || item.id || `call_${Date.now()}_${index}`,
    type: "function",
    function: {
      name: item.name || "",
      arguments: item.arguments || "{}",
    },
  }));
}

function cloneItem(item) {
  return item && typeof item === "object" ? { ...item } : item;
}

class OpenAIResponsesAdapter extends BaseLLMAdapter {
  constructor(modelConfig, credential) {
    super(modelConfig, credential);
    const baseURL = normalizeResponsesBaseURL(modelConfig.baseURL);
    this.client = new OpenAI({
      apiKey: credential.apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    this.systemPromptRole = modelConfig.systemPromptRole || "developer";
  }

  normalizeMessages(messages) {
    const effectiveMessages = this.modelConfig.supportsSystemRole === false
      ? mergeSystemIntoFirstUser(messages)
      : messages;
    const input = [];

    for (const message of effectiveMessages) {
      const responseItems = getResponseItems(message);
      if (responseItems) {
        input.push(...responseItems);
        continue;
      }

      input.push({
        role:
          message.role === "system" && this.systemPromptRole === "developer"
            ? "developer"
            : message.role,
        content: convertContentForResponses(message.content),
      });
    }

    return input;
  }

  buildRequestOptions(messages, { tools = null } = {}) {
    const options = {
      model: this.modelConfig.modelName,
      input: this.normalizeMessages(messages),
      stream: false,
    };
    const requestOptions = this.modelConfig.requestOptions ?? {};

    if (this.modelConfig.supportsThinking !== false && requestOptions.reasoningEffort) {
      options.reasoning = {
        effort: requestOptions.reasoningEffort,
        summary: requestOptions.reasoningSummary || "auto",
        ...(requestOptions.reasoningContext ? { context: requestOptions.reasoningContext } : {}),
        ...(requestOptions.reasoningMode ? { mode: requestOptions.reasoningMode } : {}),
      };
    }

    if (tools && tools.length > 0) {
      options.tools = tools.map((tool) => {
        if (tool.type !== "function") return tool;

        const definition = tool.function ?? tool;
        return {
          type: "function",
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters || { type: "object", properties: {} },
          strict: definition.strict ?? tool.strict ?? false,
        };
      });
    }

    return options;
  }

  // Responses requires the complete model output to be passed back before
  // function_call_output, including reasoning items.
  appendAssistantToolContext(messages, result) {
    const responseOutputItems = result.responseOutputItems ?? [];
    if (responseOutputItems.length > 0) {
      messages.push({ responseInputItems: responseOutputItems });
    }
  }

  appendToolResultContext(messages, toolCall, toolResult) {
    messages.push({
      responseInputItems: [{
        type: "function_call_output",
        call_id: toolCall.id || toolCall.call_id || `call_${Date.now()}`,
        output: JSON.stringify(toolResult),
      }],
    });
  }

  appendArtifactContext(messages, artifact) {
    messages.push({
      role: "user",
      source: "harness",
      content: [
        { type: "text", text: artifact.label || "[图]" },
        { type: "image_url", image_url: { url: `data:${artifact.mime};base64,${artifact.data}` } },
      ],
    });
  }

  async doCall(messages, signal) {
    const result = await this.client.responses.create(
      this.buildRequestOptions(messages),
      signal ? { signal } : undefined,
    );
    const outputItems = result.output ?? [];

    return this.buildResult({
      reply: getResponseText(result, outputItems),
      reasoning: getReasoningText(outputItems),
      usage: formatTokenUsage(result.usage),
      responseId: result.id ?? null,
    });
  }

  async doStream(messages, onChunk, signal) {
    const stream = await this.client.responses.create({
      ...this.buildRequestOptions(messages),
      stream: true,
    }, signal ? { signal } : undefined);

    return this.collectStreamResult(stream, onChunk);
  }

  async doCallWithTools(messages, tools, signal) {
    const result = await this.client.responses.create(
      this.buildRequestOptions(messages, { tools }),
      signal ? { signal } : undefined,
    );
    const outputItems = result.output ?? [];
    const functionCallItems = getFunctionCallItems(outputItems);

    return {
      ...this.buildResult({
        reply: getResponseText(result, outputItems),
        reasoning: getReasoningText(outputItems),
        usage: formatTokenUsage(result.usage),
        responseId: result.id ?? null,
      }),
      toolCalls: normalizeToolCalls(functionCallItems),
      responseOutputItems: outputItems,
    };
  }

  async doStreamWithTools(messages, tools, onChunk, signal) {
    const stream = await this.client.responses.create({
      ...this.buildRequestOptions(messages, { tools }),
      stream: true,
    }, signal ? { signal } : undefined);
    return this.collectStreamResult(stream, onChunk);
  }

  async createStreamWithTools(messages, tools, signal) {
    return this.client.responses.create({
      ...this.buildRequestOptions(messages, { tools }),
      stream: true,
    }, signal ? { signal } : undefined);
  }

  async collectStreamResult(stream, onChunk) {
    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };
    let responseId = null;
    let completedOutputItems = null;
    const outputItemsByIndex = new Map();
    const outputIndexByItemId = new Map();

    const rememberOutputItem = (item, outputIndex) => {
      if (!item) return;
      const existing = outputItemsByIndex.get(outputIndex) ?? {};
      const merged = { ...existing, ...cloneItem(item) };
      outputItemsByIndex.set(outputIndex, merged);
      if (merged.id) outputIndexByItemId.set(merged.id, outputIndex);
    };

    const getOutputIndex = (event) => {
      if (Number.isInteger(event.output_index)) return event.output_index;
      return outputIndexByItemId.get(event.item_id);
    };

    for await (const event of stream) {
      responseId = event?.response?.id ?? responseId;

      if (event?.type === "error") {
        throw new Error(event.message || "Responses API stream error");
      }

      if (event?.type === "response.failed") {
        throw new Error(event.response?.error?.message || "Responses API response failed");
      }

      if (event?.type === "response.output_item.added" || event?.type === "response.output_item.done") {
        rememberOutputItem(event.item, event.output_index);
      }

      if (event?.type === "response.output_text.delta") {
        const delta = event.delta ?? "";
        reply += delta;
        await onChunk?.({ delta });
      }

      if (event?.type === "response.refusal.delta") {
        const delta = event.delta ?? "";
        reply += delta;
        await onChunk?.({ delta });
      }

      if (event?.type === "response.reasoning_summary_part.added") {
        const delta = event.part?.text ?? "";
        reasoning += delta;
        if (delta) await onChunk?.({ delta: "", reasoningDelta: delta });
      }

      if (
        event?.type === "response.reasoning_summary_text.delta" ||
        event?.type === "response.reasoning_text.delta"
      ) {
        const delta = event.delta ?? "";
        reasoning += delta;
        if (delta) await onChunk?.({ delta: "", reasoningDelta: delta });
      }

      if (event?.type === "response.function_call_arguments.delta") {
        const outputIndex = getOutputIndex(event);
        if (outputIndex != null) {
          const item = outputItemsByIndex.get(outputIndex) ?? {
            type: "function_call",
            id: event.item_id,
          };
          item.type = item.type || "function_call";
          item.id = item.id || event.item_id;
          item.arguments = `${item.arguments ?? ""}${event.delta ?? ""}`;
          rememberOutputItem(item, outputIndex);
        }
      }

      if (event?.type === "response.function_call_arguments.done") {
        const outputIndex = getOutputIndex(event);
        if (outputIndex != null) {
          const item = outputItemsByIndex.get(outputIndex) ?? {
            type: "function_call",
            id: event.item_id,
          };
          item.type = item.type || "function_call";
          item.id = item.id || event.item_id;
          item.name = event.name ?? item.name;
          item.arguments = event.arguments ?? item.arguments ?? "{}";
          if (event.call_id) item.call_id = event.call_id;
          rememberOutputItem(item, outputIndex);
        }
      }

      if (event?.type === "response.incomplete" || event?.type === "response.completed") {
        if (Array.isArray(event.response?.output)) {
          completedOutputItems = event.response.output;
        }
        if (event.response?.usage) {
          usage = formatTokenUsage(event.response.usage);
        }
        if (!reply && event.response) {
          reply = getResponseText(event.response, completedOutputItems ?? []);
        }
        if (!reasoning && completedOutputItems) {
          reasoning = getReasoningText(completedOutputItems);
        }
      }
    }

    const outputItems = completedOutputItems ?? [...outputItemsByIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item);
    const functionCallItems = getFunctionCallItems(outputItems);

    return {
      reply: reply || getResponseText({}, outputItems),
      reasoning: reasoning || getReasoningText(outputItems),
      usage,
      responseId,
      toolCalls: normalizeToolCalls(functionCallItems),
      responseOutputItems: outputItems,
    };
  }
}

export function createOpenAIResponsesAdapter(modelConfig, credential) {
  const adapter = new OpenAIResponsesAdapter(modelConfig, credential);
  return {
    call: (args) => adapter.call(args),
    stream: (args) => adapter.stream(args),
    callWithTools: (args) => adapter.callWithTools(args),
    streamWithTools: (args) => adapter.streamWithTools(args),
  };
}
