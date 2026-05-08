import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import katex from "katex";

marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch {
          /* fall through */
        }
      }
      try {
        return hljs.highlightAuto(code).value;
      } catch {
        return escapeHtml(code);
      }
    },
  }),
);

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(text).replace(/[&<>"]/g, (ch) => map[ch]);
}

export function renderMarkdownToHtml(text = "") {
  const source = `${text ?? ""}`;
  if (!source) return "";

  // Step 1: Protect fenced code blocks and inline code from math extraction
  const codeBlocks = [];
  const codeProtected = source.replace(
    /(```[\s\S]*?```|`[^`\n]+`)/g,
    (match) => {
      codeBlocks.push(match);
      return `\u0000C${codeBlocks.length - 1}\u0000`;
    },
  );

  // Step 2: Normalize LaTeX delimiters and extract math expressions
  let work = codeProtected
    // Convert \( ... \) to $...$ (inline math)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, formula) => `$${formula.trim()}$`)
    // Convert \[ ... \] to $$...$$ (block math)
    .replace(
      /\\\[([\s\S]*?)\\\]/g,
      (_m, formula) => `$$\n${formula.trim()}\n$$`,
    );

  const mathBlocks = [];

  // Extract block math: $$...$$
  work = work.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula) => {
    mathBlocks.push({ display: true, formula: formula.trim() });
    return `\u0000M${mathBlocks.length - 1}\u0000`;
  });

  // Extract inline math: $...$ (non-empty, no leading/trailing whitespace)
  work = work.replace(/\$([^\s$](?:[^$\n]*?[^\s$])?)\$/g, (_match, formula) => {
    mathBlocks.push({ display: false, formula });
    return `\u0000M${mathBlocks.length - 1}\u0000`;
  });

  // Step 3: Parse markdown to HTML
  let html;
  try {
    html = marked.parse(work);
  } catch {
    return escapeHtml(source);
  }

  // Step 4: Restore rendered KaTeX math
  html = html.replace(/\u0000M(\d+)\u0000/g, (_match, indexStr) => {
    const block = mathBlocks[parseInt(indexStr, 10)];
    if (!block) return _match;
    try {
      return katex.renderToString(block.formula, {
        displayMode: block.display,
        throwOnError: false,
        strict: false,
      });
    } catch {
      // fallback: show raw delimiters and formula
      const raw = block.display
        ? `$$${block.formula}$$`
        : `$${block.formula}$`;
      return `<span class="katex-error">${escapeHtml(raw)}</span>`;
    }
  });

  // Step 5: Restore code blocks (marked may have HTML-escaped the null chars)
  html = html.replace(/\u0000C(\d+)\u0000/g, (_match, indexStr) => {
    const code = codeBlocks[parseInt(indexStr, 10)];
    return code ?? _match;
  });

  return html;
}

export function normalizeMarkdownMath(value = "") {
  const source = `${value ?? ""}`;
  if (!source) return "";
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, f) => `$$\n${f.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, f) => `$${f.trim()}$`);
}
