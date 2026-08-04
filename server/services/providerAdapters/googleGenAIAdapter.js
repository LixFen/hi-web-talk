import { GoogleGenAI } from "@google/genai";
import {
  formatTokenUsage,
  splitSystemMessage,
  convertMultimodalContentForGemini,
} from "./baseAdapter.js";
import { BaseLLMAdapter } from "./baseLLMAdapter.js";

/**
 * 将 OpenAI 格式的工具定义转换为 Google GenAI 格式
 */
function convertToolsForGemini(tools) {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => {
    if (tool.type === "function") {
      return {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters || { type: "object", properties: {} },
      };
    }
    return tool;
  });
}

class GoogleGenAIAdapter extends BaseLLMAdapter {
  constructor(modelConfig, credential) {
    super(modelConfig, credential);
    this.client = new GoogleGenAI({
      apiKey: credential.apiKey,
    });
  }

  buildContents(messages) {
    const { systemText, otherMessages } = splitSystemMessage(messages);

    const contents = otherMessages.map((message) => {
      // 工具结果消息 → Gemini functionResponse 格式
      if (message.role === "tool") {
        let toolResult;
        try {
          toolResult = typeof message.content === "string"
            ? JSON.parse(message.content)
            : message.content;
        } catch {
          toolResult = { result: message.content };
        }
        return {
          role: "user",
          parts: [{
            functionResponse: {
              name: message.tool_name || message.name || "unknown",
              response: toolResult,
            },
          }],
        };
      }

      const role = message.role === "assistant" || message.role === "model" ? "model" : "user";

      let parts;
      if (typeof message.content === "string") {
        parts = [{ text: message.content }];
      } else if (Array.isArray(message.content)) {
        parts = convertMultimodalContentForGemini(message.content);
      } else {
        parts = [{ text: String(message.content ?? "") }];
      }

      return { role, parts };
    });

    return { contents, systemText };
  }

  buildOptions(messages, { tools = null } = {}) {
    const { contents, systemText } = this.buildContents(messages);

    const options = {
      model: this.modelConfig.modelName,
      contents,
    };

    if (systemText) {
      options.systemInstruction = { parts: [{ text: systemText }] };
    }

    const opts = this.modelConfig.requestOptions ?? {};
    if (this.modelConfig.supportsThinking !== false) {
      const thinkingLevel = opts.thinkingLevel;
      if (thinkingLevel && thinkingLevel !== "") {
        options.generationConfig = {
          ...(options.generationConfig ?? {}),
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel,
          },
        };
      }
    }

    // 注入工具定义
    const geminiTools = convertToolsForGemini(tools);
    if (geminiTools && geminiTools.length > 0) {
      options.tools = [{ functionDeclarations: geminiTools }];
    }

    return options;
  }

  parseUsage(usageMetadata) {
    if (!usageMetadata) {
      return { input: 0, output: 0, total: 0 };
    }
    return formatTokenUsage({
      input_tokens: usageMetadata.promptTokenCount,
      output_tokens: usageMetadata.candidatesTokenCount,
      total_tokens: usageMetadata.totalTokenCount,
    });
  }

  // ── 原有方法（向后兼容） ──

  async doCall(messages, signal) {
    const options = withAbortSignal(this.buildOptions(messages), signal);
    const result = await this.client.models.generateContent(options);

    const candidate = result.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    let reply = "";
    let reasoning = "";

    for (const part of parts) {
      if (part.thought) {
        reasoning += part.text ?? "";
      } else {
        reply += part.text ?? "";
      }
    }

    return this.buildResult({
      reply,
      reasoning,
      usage: this.parseUsage(result.usageMetadata),
      responseId: null,
    });
  }

  async doStream(messages, onChunk, signal) {
    const options = withAbortSignal(this.buildOptions(messages), signal);
    const streamResult = await this.client.models.generateContentStream(options);

    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };

    for await (const chunk of streamResult) {
      const candidates = chunk.candidates ?? [];

      for (const candidate of candidates) {
        const parts = candidate.content?.parts ?? [];

        for (const part of parts) {
          const text = part.text ?? "";
          if (!text) continue;

          if (part.thought) {
            reasoning += text;
            await onChunk?.({ delta: "", reasoningDelta: text });
          } else {
            reply += text;
            await onChunk?.({ delta: text });
          }
        }
      }

      if (chunk.usageMetadata) {
        usage = this.parseUsage(chunk.usageMetadata);
      }
    }

    return this.buildResult({
      reply,
      reasoning,
      usage,
      responseId: null,
    });
  }

  // ── Tool Calling 方法 ──

  async doCallWithTools(messages, tools, signal) {
    const options = withAbortSignal(this.buildOptions(messages, { tools }), signal);
    const result = await this.client.models.generateContent(options);

    const candidate = result.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    let reply = "";
    let reasoning = "";
    const functionCalls = [];

    for (const part of parts) {
      if (part.thought) {
        reasoning += part.text ?? "";
      } else if (part.functionCall) {
        functionCalls.push(part.functionCall);
      } else {
        reply += part.text ?? "";
      }
    }

    const toolCalls =
      functionCalls.length > 0
        ? functionCalls.map((fc, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: "function",
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.args || {}),
            },
          }))
        : [];

    // 构造 assistant message (Gemini 格式)
    const assistantParts = [];
    if (reply) assistantParts.push({ text: reply });
    for (const fc of functionCalls) {
      assistantParts.push({ functionCall: fc });
    }

    const assistantMessage = {
      role: "model",
      parts: assistantParts.length > 0 ? assistantParts : [{ text: reply || "" }],
    };

    return {
      ...this.buildResult({
        reply,
        reasoning,
        usage: this.parseUsage(result.usageMetadata),
        responseId: null,
      }),
      toolCalls,
      message: assistantMessage,
    };
  }

  async doStreamWithTools(messages, tools, onChunk, signal) {
    const options = withAbortSignal(this.buildOptions(messages, { tools }), signal);
    const streamResult = await this.client.models.generateContentStream(options);
    return this.collectStreamResult(streamResult, onChunk);
  }

  async createStreamWithTools(messages, tools, signal) {
    const options = withAbortSignal(this.buildOptions(messages, { tools }), signal);
    return this.client.models.generateContentStream(options);
  }

  async collectStreamResult(streamResult, onChunk) {
    let reply = "";
    let reasoning = "";
    let usage = { input: 0, output: 0, total: 0 };
    const functionCalls = [];

    for await (const chunk of streamResult) {
      const candidates = chunk.candidates ?? [];

      for (const candidate of candidates) {
        const parts = candidate.content?.parts ?? [];

        for (const part of parts) {
          const text = part.text ?? "";
          if (part.thought) {
            reasoning += text;
            // 非最终调用时发 reasoning
            await onChunk?.({ delta: "", reasoningDelta: text });
          } else if (part.functionCall) {
            functionCalls.push(part.functionCall);
          } else {
            reply += text;
            await onChunk?.({ delta: text });
          }
        }
      }

      if (chunk.usageMetadata) {
        usage = this.parseUsage(chunk.usageMetadata);
      }
    }

    const toolCalls =
      functionCalls.length > 0
        ? functionCalls.map((fc, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: "function",
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.args || {}),
            },
          }))
        : [];

    // 构造 assistant message
    const assistantParts = [];
    if (reply) assistantParts.push({ text: reply });
    for (const fc of functionCalls) {
      assistantParts.push({ functionCall: fc });
    }

    const assistantMessage = {
      role: "model",
      parts: assistantParts.length > 0 ? assistantParts : [{ text: reply || "" }],
    };

    return {
      reply,
      reasoning,
      usage,
      responseId: null,
      toolCalls,
      message: assistantMessage,
    };
  }
}

function withAbortSignal(options, signal) {
  if (!signal) return options;
  return {
    ...options,
    config: {
      ...(options.config ?? {}),
      abortSignal: signal,
    },
  };
}

export function createGoogleGenAIAdapter(modelConfig, credential) {
  const adapter = new GoogleGenAIAdapter(modelConfig, credential);
  return {
    call: (args) => adapter.call(args),
    stream: (args) => adapter.stream(args),
    callWithTools: (args) => adapter.callWithTools(args),
    streamWithTools: (args) => adapter.streamWithTools(args),
  };
}
