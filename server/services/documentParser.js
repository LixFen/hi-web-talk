import { readAttachment } from "./attachmentService.js";

let pdfParse;
let mammoth;

async function getPdfParse() {
  if (!pdfParse) {
    pdfParse = (await import("pdf-parse")).default;
  }
  return pdfParse;
}

async function getMammoth() {
  if (!mammoth) {
    mammoth = (await import("mammoth")).default;
  }
  return mammoth;
}

export async function parseDocument(buffer, mimeType, fileName) {
  const ext = fileName?.toLowerCase().split(".").pop() || "";

  if (mimeType === "application/pdf" || ext === "pdf") {
    try {
      const parse = await getPdfParse();
      const data = await parse(buffer, { max: 500 }); // ponytail: 500 page limit
      return data.text || "[PDF 文件未包含可提取的文本内容]";
    } catch (err) {
      return `[PDF 解析失败: ${err.message}]`;
    }
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    try {
      const mam = await getMammoth();
      const result = await mam.extractRawText({ buffer });
      return result.value || "[DOCX 文件未包含可提取的文本内容]";
    } catch (err) {
      return `[DOCX 解析失败: ${err.message}]`;
    }
  }

  if (mimeType === "text/plain" || ext === "txt") {
    return buffer.toString("utf-8");
  }

  return `[不支持的文件格式: ${fileName}]`;
}

/**
 * Resolve a document_attachment block: read the stored attachment, parse it,
 * and return a text block with the extracted content wrapped in <UploadFile>.
 */
export async function resolveDocumentBlock(block) {
  const attachment = await readAttachment(block.attachmentId);

  if (!attachment) {
    return {
      type: "text",
      text: `[文档附件已失效: ${block.fileName ?? block.attachmentId}]`,
    };
  }

  const text = await parseDocument(
    attachment.buffer,
    attachment.mimeType,
    attachment.fileName,
  );

  return {
    type: "text",
    text: `<UploadFile name="${attachment.fileName}">\n\`\`\`\n${text}\n\`\`\`\n</UploadFile>`,
  };
}
