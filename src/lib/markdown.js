export function normalizeMarkdownMath(value = "") {
  const source = `${value ?? ""}`;

  if (!source) {
    return "";
  }

  // remark-math v6 only supports $...$ and $$...$$ by default.
  // We must convert \(...\) and \[...\] to the supported delimiters.
  // Code blocks are preserved to avoid modifying math inside them.

  const fencedCodeBlockPattern = /(```[\s\S]*?```|`[^`\n]*`)/g;
  const segments = source.split(fencedCodeBlockPattern);

  return segments
    .map((segment) => {
      if (segment.startsWith("```")) {
        return segment;
      }

      // Convert \[ ... \] to $$ ... $$ (block math)
      // Handles both inline-style \[ formula \] and block-style with newlines
      let result = segment.replace(
        /\\\[\s*\n?((?:[^\n]|\n(?!\s*\\\]))*)\n?\s*\\\]/g,
        (_match, formula) => `$$\n${formula.trim()}\n$$`,
      );

      // Convert \( ... \) to $...$ (inline math)
      result = result.replace(
        /\\\(([\s\S]*?)\\\)/g,
        (_match, formula) => `$${formula.trim()}$`,
      );

      return result;
    })
    .join("");
}