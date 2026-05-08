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

      // KaTeX errors on stray '$' inside math; escape them in math segments.
      result = escapeDollarInsideMath(result);

      return result;
    })
    .join("");
}

function escapeDollarInsideMath(input = "") {
  let output = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char === "\\") {
      output += input.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char !== "$") {
      output += char;
      index += 1;
      continue;
    }

    const isBlock = input[index + 1] === "$";
    const delimiterLength = isBlock ? 2 : 1;
    const start = index + delimiterLength;
    let end = start;

    while (end < input.length) {
      if (input[end] === "\\") {
        end += 2;
        continue;
      }

      if (isBlock && input[end] === "$" && input[end + 1] === "$") {
        break;
      }

      if (!isBlock && input[end] === "$") {
        break;
      }

      end += 1;
    }

    if (end >= input.length) {
      output += char;
      index += 1;
      continue;
    }

    const content = input
      .slice(start, end)
      .replace(/(^|[^\\])\$/g, (_match, prefix) => `${prefix}\\$`);

    output += `${"$".repeat(delimiterLength)}${content}${"$".repeat(delimiterLength)}`;
    index = end + delimiterLength;
  }

  return output;
}