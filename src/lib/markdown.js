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

  const MC = "\uE001"; // Unicode PUA – survives marked parser & browser innerHTML
  const mathBlocks = [];

  // Split into code vs non-code segments. Only process non-code segments
  // so that $/$$ inside code blocks are never touched.
  const processed = source
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((segment, i) => {
      // Odd segments are code blocks – pass through unchanged.
      if (i % 2 === 1) return segment;

      let work = segment
        // Normalize \( ... \) → $...$
        .replace(/\\\(([\s\S]*?)\\\)/g, (_m, f) => `$${f.trim()}$`)
        // Normalize \[ ... \] → $$...$$
        .replace(
          /\\\[([\s\S]*?)\\\]/g,
          (_m, f) => `$$\n${f.trim()}\n$$`,
        );

      // Extract block math: $$...$$
      work = work.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula) => {
        mathBlocks.push({ display: true, formula: formula.trim() });
        return `${MC}${mathBlocks.length - 1}${MC}`;
      });

      // Extract inline math: $...$ (non-empty, no leading/trailing whitespace)
      work = work.replace(
        /\$([^\s$](?:[^$\n]*?[^\s$])?)\$/g,
        (_match, formula) => {
          mathBlocks.push({ display: false, formula });
          return `${MC}${mathBlocks.length - 1}${MC}`;
        },
      );

      return work;
    })
    .join("");

  // Parse markdown to HTML.
  let html;
  try {
    html = marked.parse(processed);
  } catch {
    return escapeHtml(source);
  }

  // Replace math placeholders with KaTeX-rendered HTML.
  html = html.replace(
    new RegExp(`${MC}(\\d+)${MC}`, "g"),
    (_match, indexStr) => {
      const block = mathBlocks[parseInt(indexStr, 10)];
      if (!block) return _match;
      try {
        return katex.renderToString(block.formula, {
          displayMode: block.display,
          throwOnError: false,
          strict: false,
        });
      } catch {
        const raw = block.display
          ? `$$${block.formula}$$`
          : `$${block.formula}$`;
        return `<span class="katex-error">${escapeHtml(raw)}</span>`;
      }
    },
  );

  return html;
}

export function normalizeMarkdownMath(value = "") {
  const source = `${value ?? ""}`;
  if (!source) return "";
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, f) => `$$\n${f.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, f) => `$${f.trim()}$`);
}
