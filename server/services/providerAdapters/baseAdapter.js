export function splitSystemMessage(messages) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const otherMessages = messages.filter((message) => message.role !== "system");
  const systemText = systemMessages.map((message) => message.content).filter(Boolean).join("\n");

  return { systemText, otherMessages };
}

export function mergeSystemIntoFirstUser(messages) {
  const { systemText, otherMessages } = splitSystemMessage(messages);

  if (!systemText || otherMessages.length === 0) {
    return otherMessages;
  }

  const firstUserIndex = otherMessages.findIndex((message) => message.role === "user");

  if (firstUserIndex === -1) {
    return [
      {
        role: "user",
        content: systemText,
      },
      ...otherMessages,
    ];
  }

  const firstUser = otherMessages[firstUserIndex];
  const mergedContent = typeof firstUser.content === "string"
    ? `${systemText}\n\n${firstUser.content}`
    : [
        { type: "text", text: systemText },
        ...(Array.isArray(firstUser.content) ? firstUser.content : [{ type: "text", text: String(firstUser.content ?? "") }]),
      ];

  return [
    ...otherMessages.slice(0, firstUserIndex),
    {
      ...firstUser,
      content: mergedContent,
    },
    ...otherMessages.slice(firstUserIndex + 1),
  ];
}

export function formatTokenUsage(usage = {}) {
  const input = Number(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.input ?? 0,
  );
  const output = Number(
    usage.output_tokens ?? usage.completion_tokens ?? usage.output ?? 0,
  );
  const total = Number(usage.total_tokens ?? usage.total ?? input + output);

  return { input, output, total };
}

export function isMultimodalContent(content) {
  return Array.isArray(content);
}

export function normalizeMultimodalContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return String(content ?? "");
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return { type: "text", text: block };
      }

      if (!block || typeof block !== "object") {
        return null;
      }

      if (block.type === "text") {
        return { type: "text", text: block.text ?? "" };
      }

      if (block.type === "image_url") {
        return {
          type: "image_url",
          image_url: block.image_url,
        };
      }

      return block;
    })
    .filter(Boolean);
}

function parseDataUri(url) {
  if (typeof url !== "string" || !url.startsWith("data:")) {
    return null;
  }

  const match = url.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  return { mimeType: match[1], data: match[2] };
}

export function convertMultimodalContentForClaude(content) {
  const normalized = normalizeMultimodalContent(content);

  if (typeof normalized === "string") {
    return normalized;
  }

  return normalized.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text ?? "" };
    }

    if (block.type === "image_url") {
      const url = block.image_url?.url ?? "";
      const parsed = parseDataUri(url);

      if (parsed) {
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: parsed.mimeType,
            data: parsed.data,
          },
        };
      }

      return {
        type: "image",
        source: {
          type: "url",
          url,
        },
      };
    }

    return { type: "text", text: JSON.stringify(block) };
  });
}

export function convertMultimodalContentForGemini(content) {
  const normalized = normalizeMultimodalContent(content);

  if (typeof normalized === "string") {
    return [{ text: normalized }];
  }

  return normalized.map((block) => {
    if (block.type === "text") {
      return { text: block.text ?? "" };
    }

    if (block.type === "image_url") {
      const url = block.image_url?.url ?? "";
      const parsed = parseDataUri(url);

      if (parsed) {
        return {
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        };
      }

      return { text: `[Image: ${url}]` };
    }

    return { text: JSON.stringify(block) };
  });
}

export function convertMultimodalContentForOpenAI(content) {
  const normalized = normalizeMultimodalContent(content);

  if (typeof normalized === "string") {
    return normalized;
  }

  return normalized.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text ?? "" };
    }

    if (block.type === "image_url") {
      return {
        type: "image_url",
        image_url: block.image_url ?? { url: "" },
      };
    }

    return block;
  });
}
