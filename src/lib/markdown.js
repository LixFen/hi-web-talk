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
      if (segment.startsWith("`")) {
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

      // Escape unmatched math delimiters so they stay as plain text.
      result = escapeUnpairedMathDelimiters(result);

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

function escapeUnpairedMathDelimiters(input = "") {
  const dollarEscapes = new Set();
  const inlineStack = [];
  const blockStack = [];

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char !== "$") {
      continue;
    }

    const isBlock = input[index + 1] === "$";

    if (isBlock) {
      if (blockStack.length > 0) {
        blockStack.pop();
      } else {
        blockStack.push(index);
      }
      index += 1;
      continue;
    }

    if (inlineStack.length > 0) {
      inlineStack.pop();
    } else {
      inlineStack.push(index);
    }
  }

  for (const index of inlineStack) {
    dollarEscapes.add(index);
  }

  for (const index of blockStack) {
    dollarEscapes.add(index);
    dollarEscapes.add(index + 1);
  }

  const output = [];
  for (let index = 0; index < input.length; index += 1) {
    if (dollarEscapes.has(index)) {
      output.push("\\$");
      continue;
    }
    output.push(input[index]);
  }

  return escapeUnpairedBracketDelimiters(output.join(""));
}

function escapeUnpairedBracketDelimiters(input = "") {
  return escapeUnpairedBackslashPairs(input, "(", ")");
}

function escapeUnpairedBackslashPairs(input, openChar, closeChar) {
  const openStack = [];
  const openIndexesToEscape = new Set();
  const closeIndexesToEscape = new Set();

  for (let index = 0; index < input.length - 1; index += 1) {
    if (input[index] !== "\\") {
      continue;
    }

    const nextChar = input[index + 1];
    if (nextChar === openChar) {
      openStack.push(index);
      index += 1;
      continue;
    }

    if (nextChar === closeChar) {
      if (openStack.length > 0) {
        openStack.pop();
      } else {
        closeIndexesToEscape.add(index);
      }
      index += 1;
    }
  }

  for (const index of openStack) {
    openIndexesToEscape.add(index);
  }

  if (openIndexesToEscape.size === 0 && closeIndexesToEscape.size === 0) {
    return input;
  }

  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    if ((openIndexesToEscape.has(index) || closeIndexesToEscape.has(index)) && input[index] === "\\") {
      output += "\\\\";
      continue;
    }
    output += input[index];
  }

  return output;
}