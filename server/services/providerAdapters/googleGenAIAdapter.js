import { GoogleGenAI } from "@google/genai";
import {
  formatTokenUsage,
  splitSystemMessage,
  convertMultimodalContentForGemini,
} from "./baseAdapter.js";

export function createGoogleGenAIAdapter(modelConfig, credential) {
  const client = new GoogleGenAI({
    apiKey: credential.apiKey,
  });

  function buildContents(messages) {
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

  async function call({ messages }) {
    const { contents, systemText } = buildContents(messages);

    const options = {
      model: modelConfig.modelName,
      contents,
    };

    if (systemText) {
      options.systemInstruction = { parts: [{ text: systemText }] };
    }

    const opts = modelConfig.requestOptions ?? {};
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

    const result = await client.models.generateContent(options);

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

    return {
      reply: reply || "",
      reasoning: reasoning.trim() || "",
      usage: formatTokenUsage({
        input_tokens: result.usageMetadata?.promptTokenCount,
        output_tokens: result.usageMetadata?.candidatesTokenCount,
        total_tokens: result.usageMetadata?.totalTokenCount,
      }),
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId: null,
    };
  }

  async function stream({ messages, onChunk }) {
    const { contents, systemText } = buildContents(messages);

    const options = {
      model: modelConfig.modelName,
      contents,
    };

    if (systemText) {
      options.systemInstruction = { parts: [{ text: systemText }] };
    }

    const opts = modelConfig.requestOptions ?? {};
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

    const streamResult = await client.models.generateContentStream(options);

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
        usage = formatTokenUsage({
          input_tokens: chunk.usageMetadata.promptTokenCount,
          output_tokens: chunk.usageMetadata.candidatesTokenCount,
          total_tokens: chunk.usageMetadata.totalTokenCount,
        });
      }
    }

    return {
      reply: reply.trim() || "",
      reasoning: reasoning.trim() || "",
      usage,
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId: null,
    };
  }

  return { call, stream };
}
