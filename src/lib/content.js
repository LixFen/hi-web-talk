/**
 * Extract plain text from a prompt value that may be a string or an array of
 * multimodal content blocks (e.g. [{type:"text", text:"..."}, {type:"image_attachment", ...}]).
 */
export function extractPromptText(prompt) {
  if (typeof prompt === "string") {
    return prompt;
  }

  if (Array.isArray(prompt)) {
    return prompt
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }

  return prompt ? String(prompt) : "";
}

export function extractPromptAttachments(prompt) {
  if (!Array.isArray(prompt)) {
    return [];
  }

  return prompt.filter(
    (block) => (block.type === "image_attachment" || block.type === "document_attachment") && block.attachmentId,
  );
}
