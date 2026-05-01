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

    const result = await client.models.generateContent(options);

    const reply = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return {
      reply: reply || "",
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

    const streamResult = await client.models.generateContentStream(options);

    let reply = "";
    let usage = { input: 0, output: 0, total: 0 };

    for await (const chunk of streamResult) {
      const text = chunk.text ?? "";

      if (text) {
        reply += text;
        await onChunk?.(text);
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
      usage,
      provider: modelConfig.providerType,
      providerType: modelConfig.providerType,
      model: modelConfig.modelName,
      responseId: null,
    };
  }

  return { call, stream };
}
