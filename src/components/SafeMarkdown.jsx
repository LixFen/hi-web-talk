import { useMemo } from "react";
import { renderMarkdownToHtml } from "../lib/markdown";

export default function SafeMarkdown({ children, className = "" }) {
  const html = useMemo(() => {
    try {
      return renderMarkdownToHtml(children);
    } catch {
      return `<pre>${String(children ?? "")}</pre>`;
    }
  }, [children]);

  return (
    <div
      className={`markdown-body ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
