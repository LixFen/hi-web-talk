import { useRef, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLocale } from "../contexts/LocaleContext";

export default function ViewModeSwitcher() {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentView = searchParams.get("view") || "chat";
  const switcherRef = useRef(null);
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 });

  const viewOptions = [
    { id: "chat", label: t("view.chat") },
    { id: "chain", label: t("view.chain") },
    { id: "graph", label: t("view.graph") },
  ];

  useEffect(() => {
    const switcher = switcherRef.current;
    if (!switcher) return;
    const activeBtn = switcher.querySelector(`.view-mode-btn[data-view="${currentView}"]`);
    if (!activeBtn) return;
    const switcherRect = switcher.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setPillStyle({
      left: btnRect.left - switcherRect.left,
      width: btnRect.width,
    });
  }, [currentView]);

  function handleChange(nextMode) {
    if (nextMode === currentView) return;
    const next = new URLSearchParams(searchParams);
    if (nextMode === "chat") {
      next.delete("view");
    } else {
      next.set("view", nextMode);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="view-mode-switcher" ref={switcherRef} role="tablist" aria-label={t("view.switcher") }>
      <div className="view-mode-pill" style={pillStyle} />
      {viewOptions.map((option) => (
        <button
          key={option.id}
          type="button"
          data-view={option.id}
          className={`view-mode-btn ${currentView === option.id ? "active" : ""}`}
          onClick={() => handleChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
