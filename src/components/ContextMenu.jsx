import React, { useEffect, useRef } from "react";

function clampMenuPosition(x, y, menuWidth, menuHeight) {
  const padding = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let adjustedX = x;
  let adjustedY = y;

  if (adjustedX + menuWidth + padding > viewportWidth) {
    adjustedX = viewportWidth - menuWidth - padding;
  }

  if (adjustedY + menuHeight + padding > viewportHeight) {
    adjustedY = viewportHeight - menuHeight - padding;
  }

  if (adjustedX < padding) {
    adjustedX = padding;
  }

  if (adjustedY < padding) {
    adjustedY = padding;
  }

  return { x: adjustedX, y: adjustedY };
}

export default function ContextMenu({ x, y, visible, items, onClose }) {
  const menuRef = useRef(null);
  const positionRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!visible) return undefined;

    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose?.();
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    const handleScroll = () => {
      onClose?.();
    };

    const handleResize = () => {
      onClose?.();
    };

    setTimeout(() => {
      document.addEventListener("click", handleClick, true);
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleResize);
    }, 0);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [visible, onClose]);

  if (!visible || !items?.length) {
    return null;
  }

  const safeItems = items.filter((item) => item && !item.hidden);
  if (safeItems.length === 0) {
    return null;
  }

  const menuWidth = 220;
  const estimatedMenuHeight = safeItems.length * 42 + 16;
  const { x: adjustedX, y: adjustedY } = clampMenuPosition(x, y, menuWidth, estimatedMenuHeight);
  positionRef.current = { x: adjustedX, y: adjustedY };

  return (
    <div className="context-menu-overlay">
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: adjustedX, top: adjustedY }}
        role="menu"
      >
        {safeItems.map((item, index) =>
          item.separator ? (
            <div key={item.key || `sep-${index}`} className="context-menu-separator" />
          ) : (
            <button
              key={item.key}
              className={`context-menu-item ${item.danger ? "danger" : ""} ${item.checked ? "checked" : ""}`.trim()}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.();
                onClose?.();
              }}
            >
              {item.icon ? <span className="context-menu-item-icon">{item.icon}</span> : null}
              <span className="context-menu-item-label">{item.label}</span>
              {item.checked ? (
                <span className="context-menu-item-check" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              ) : null}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
