import { GoogleGenAI } from "@google/genai";
import {
  formatTokenUsage,
  splitSystemMessage,
  convertMultimodalContentForGemini,
} from "./baseAdapter.js";
import { BaseLLMAdapter } from "./baseLLMAdapter.js";

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
      const role = message.role === "assistant" ? "model" : "user";

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

  buildOptions(messages) {
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

  async doCall(messages) {
    const options = this.buildOptions(messages);
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

  async doStream(messages, onChunk) {
    const options = this.buildOptions(messages);
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
}

export function createGoogleGenAIAdapter(modelConfig, credential) {
  const adapter = new GoogleGenAIAdapter(modelConfig, credential);
  return { call: (args) => adapter.call(args), stream: (args) => adapter.stream(args) };
}
