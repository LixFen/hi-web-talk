import { readAttachment } from "../attachmentService.js";

export async function resolveAttachmentBlocks(content) {
  if (typeof content === "string" || !Array.isArray(content)) {
    return content;
  }

  const resolved = [];

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }

    if (block.type === "image_attachment") {
      const attachment = await readAttachment(block.attachmentId);

      if (attachment) {
        const base64 = attachment.buffer.toString("base64");
        resolved.push({
          type: "image_url",
          image_url: {
            url: `data:${attachment.mimeType};base64,${base64}`,
          },
        });
      } else {
        resolved.push({
          type: "text",
          text: `[图片附件已失效: ${block.fileName ?? block.attachmentId}]`,
        });
      }

      continue;
    }

    resolved.push(block);
  }

  return resolved;
}

export async function resolveAttachmentMessages(messages) {
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      content: await resolveAttachmentBlocks(message.content),
    })),
  );
}
