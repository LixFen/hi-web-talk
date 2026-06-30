import React, { useState } from "react";

/**
 * 将文本中的 [citation:N] 替换为 markdown 链接 [N](url)
 */
export function renderCitations(text, sources) {
  if (!sources || sources.length === 0 || !text) return text;
  const sourceMap = {};
  sources.forEach((s) => {
    if (s.citationId && s.url) sourceMap[s.citationId] = s.url;
  });
  return text.replace(/\[citation:(\d+)\]/g, (match, id) => {
    const url = sourceMap[parseInt(id)];
    if (!url) return match;
    return `[${id}](${url})`;
  });
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getFaviconUrl(url) {
  try {
    const origin = new URL(url).origin;
    return `https://www.google.com/s2/favicons?domain=${origin}&sz=32`;
  } catch {
    return "";
  }
}

function Chevron({ open }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function SearchSources({ sources, defaultCollapsed = true }) {
  const [open, setOpen] = useState(!defaultCollapsed);

  if (!sources || sources.length === 0) return null;

  return (
    <div className={`search-sources-cards${open ? " open" : ""}`}>
      <button
        className="search-sources-toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        搜索来源 ({sources.length})
        <Chevron open={open} />
      </button>
      <div className="search-sources-grid-wrap">
        <div className="search-sources-grid">
          {sources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="search-source-card"
              title={s.snippet || s.title}
            >
              {s.citationId && (
                <span className="search-source-citation-badge">[{s.citationId}]</span>
              )}
              {s.image && (
                <img
                  className="search-source-card-thumb"
                  src={s.image}
                  alt=""
                  width="80"
                  height="56"
                  loading="lazy"
                  onError={(e) => { e.target.style.display = "none"; }}
                />
              )}
              <div className="search-source-card-body">
                <span className="search-source-card-title">{s.title}</span>
                {s.snippet && (
                  <span className="search-source-card-snippet">{s.snippet}</span>
                )}
                <span className="search-source-card-domain">
                  <img
                    className="search-source-favicon"
                    src={getFaviconUrl(s.url)}
                    alt=""
                    width="14"
                    height="14"
                    loading="lazy"
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                  {getDomain(s.url)}
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
