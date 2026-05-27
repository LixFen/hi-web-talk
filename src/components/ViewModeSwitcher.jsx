import { useSearchParams } from "react-router-dom";
import { useLocale } from "../contexts/LocaleContext";

export default function ViewModeSwitcher() {
  const { t } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentView = searchParams.get("view") || "chat";

  const viewOptions = [
    { id: "chat", label: t("view.chat") },
    { id: "chain", label: t("view.chain") },
    { id: "graph", label: t("view.graph") },
  ];

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
    <div className="view-mode-switcher" role="tablist" aria-label={t("view.switcher") }>
      {viewOptions.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`view-mode-btn ${currentView === option.id ? "active" : ""}`}
          onClick={() => handleChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
