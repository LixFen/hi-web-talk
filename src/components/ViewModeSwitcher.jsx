import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLocale } from "../contexts/LocaleContext";

const MOBILE_BREAKPOINT = 600;

export default function ViewModeSwitcher() {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentView = searchParams.get("view") || "chat";
  const switcherRef = useRef(null);
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 });
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);

  const viewOptions = [
    { id: "chat", label: t("view.chat") },
    { id: "chain", label: t("view.chain") },
    { id: "graph", label: t("view.graph") },
  ];

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < MOBILE_BREAKPOINT);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const switcher = switcherRef.current;
    if (!switcher || isNarrow) return;
    const activeBtn = switcher.querySelector(`.view-mode-btn[data-view="${currentView}"]`);
    if (!activeBtn) return;
    const switcherRect = switcher.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setPillStyle({
      left: btnRect.left - switcherRect.left,
      width: btnRect.width,
    });
  }, [currentView, isNarrow]);

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

  function cycleView() {
    const currentIndex = viewOptions.findIndex((v) => v.id === currentView);
    const nextIndex = (currentIndex + 1) % viewOptions.length;
    handleChange(viewOptions[nextIndex].id);
  }

  // 窄屏：单个循环按钮，点击切换
  if (isNarrow) {
    const currentLabel = viewOptions.find((v) => v.id === currentView)?.label ?? "";
    return (
      <div className="view-mode-switcher view-mode-switcher-narrow" role="tablist" aria-label={t("view.switcher")}>
        <button
          type="button"
          className="view-mode-btn view-mode-cycle-btn"
          onClick={cycleView}
          aria-label={t("view.switchTo")}
        >
          {currentLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="view-mode-switcher" ref={switcherRef} role="tablist" aria-label={t("view.switcher")}>
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
