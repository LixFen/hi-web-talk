const VIEW_OPTIONS = [
  { id: "chat", label: "聊天视图" },
  { id: "chain", label: "卡片链" },
  { id: "graph", label: "网状图" },
];

export default function ViewModeSwitcher({ value, onChange }) {
  return (
    <div className="view-mode-switcher" role="tablist" aria-label="视图切换">
      {VIEW_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`view-mode-btn ${value === option.id ? "active" : ""}`}
          onClick={() => onChange?.(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
