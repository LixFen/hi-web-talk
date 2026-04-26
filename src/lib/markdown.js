export function normalizeMarkdownMath(value = "") {
  const source = `${value ?? ""}`;

  if (!source) {
    return "";
  }

  const fencedCodeBlockPattern = /(```[\s\S]*?```|`[^`\n]*`)/g;
  const segments = source.split(fencedCodeBlockPattern);

  return segments
    .map((segment) => {
      if (segment.startsWith("```")) {
        return segment;
      }

      const normalizedBlockMath = segment.replace(
        /(^[ \t]*)\\\[\s*\n([\s\S]*?)\n\1\\\]/gm,
        (_match, indent, formula) => {
          const normalizedFormula = formula
            .trim()
            .split("\n")
            .map((line) => `${indent}${line.trimEnd()}`)
            .join("\n");

          return `${indent}$$\n${normalizedFormula}\n${indent}$$`;
        },
      );

      return normalizedBlockMath.replace(/\\\(([^\n]+?)\\\)/g, (_match, formula) => {
        return `$${formula.trim()}$`;
      });
    })
    .join("");
}