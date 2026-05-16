import { useSearchParams } from "react-router-dom";

const VIEW_OPTIONS = [
  { id: "chat", label: "聊天视图" },
  { id: "chain", label: "卡片链" },
  { id: "graph", label: "网状图" },
];

export default function ViewModeSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentView = searchParams.get("view") || "chat";

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
    <div className="view-mode-switcher" role="tablist" aria-label="视图切换">
      {VIEW_OPTIONS.map((option) => (
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
