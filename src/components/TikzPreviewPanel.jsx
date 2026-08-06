import { useRef, useEffect, useState, useCallback } from "react";
import { useLocale } from "../contexts/LocaleContext";
import SafeMarkdown from "./SafeMarkdown";

function sanitizeSvg(svg) {
  if (typeof svg !== "string" || !svg.trim()) return "";

  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror") || !document.documentElement) {
    return "";
  }

  for (const node of document.querySelectorAll("script, foreignObject, iframe, object, embed")) {
    node.remove();
  }

  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      } else if (
        (name === "href" || name === "xlink:href") &&
        !value.startsWith("#") &&
        !value.startsWith("data:image/")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return document.documentElement.outerHTML;
}

export default function TikzPreviewPanel({ open, tikzData, contextText, onClose }) {
  const { t } = useLocale();
  const svgContainerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    if (open) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [open, tikzData?.svg]);

  useEffect(() => {
    if (open && tikzData?.svg && svgContainerRef.current) {
      svgContainerRef.current.innerHTML = sanitizeSvg(tikzData.svg);
    }
  }, [open, tikzData?.svg]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setScale((s) => Math.max(0.2, Math.min(10, s - e.deltaY * 0.002)));
  }, []);

  const handleMouseDown = useCallback((e) => {
    dragRef.current.active = true;
    dragRef.current.startX = e.clientX - offset.x;
    dragRef.current.startY = e.clientY - offset.y;
  }, [offset]);

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return;
    setOffset({
      x: e.clientX - dragRef.current.startX,
      y: e.clientY - dragRef.current.startY,
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  if (!open) return null;

  return (
    <div
      className="tikz-preview-shell"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="tikz-preview-blur" />
      <div className="tikz-preview-context" onClick={onClose}>
        {contextText ? (
          <div className="tikz-preview-context-body">
            <div className="tikz-preview-context-label">{t("tikz.contextLabel")}</div>
            <div className="tikz-preview-context-text">
              <SafeMarkdown>{contextText}</SafeMarkdown>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="tikz-preview-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("tikz.previewTitle")}
      >
        <div className="tikz-preview-header">
          <span className="tikz-preview-title">{t("tikz.previewTitle")}</span>
          <button
            className="tikz-preview-close-btn"
            type="button"
            onClick={onClose}
            aria-label={t("common.close") || "关闭"}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div
          className="tikz-preview-body"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          style={{ cursor: dragRef.current.active ? "grabbing" : "grab" }}
        >
          {tikzData?.svg ? (
            <div
              className="tikz-svg-container"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              }}
              ref={svgContainerRef}
            />
          ) : (
            <div className="tikz-preview-empty">{t("tikz.noPreview")}</div>
          )}
        </div>

        <div className="tikz-preview-toolbar">
          <button className="tikz-zoom-btn" type="button" onClick={() => setScale((s) => Math.min(10, s + 0.25))} title="放大">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <span className="tikz-zoom-label">{Math.round(scale * 100)}%</span>
          <button className="tikz-zoom-btn" type="button" onClick={() => setScale((s) => Math.max(0.2, s - 0.25))} title="缩小">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <button className="tikz-zoom-btn" type="button" onClick={resetView} title="回中">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="7" />
              <line x1="12" y1="17" x2="12" y2="22" />
              <line x1="2" y1="12" x2="7" y2="12" />
              <line x1="17" y1="12" x2="22" y2="12" />
            </svg>
          </button>
        </div>

        {tikzData?.code && (
          <details className="tikz-preview-code">
            <summary>{t("tikz.showCode")}</summary>
            <pre><code>{tikzData.code}</code></pre>
          </details>
        )}
      </div>
    </div>
  );
}
