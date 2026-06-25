import React from "react";
import { useLocale } from "../contexts/LocaleContext";

export default function SystemPromptSelector({
  items = [],
  combos = [],
  defaultPrompt = "",
  selectedKey,
  onSelect,
  onOpenSettings,
}) {
  const { t } = useLocale();
  const hasItems = items.length > 0 || combos.length > 0 || defaultPrompt;
  if (!hasItems) return null;

  return (
    <div className="system-prompt-selector">
      <div className="system-prompt-scroll">
        <button
          type="button"
          className={`system-prompt-chip ${!selectedKey ? "active" : ""}`}
          onClick={() => onSelect("", "")}
          title={defaultPrompt || t("prompt.defaultHint")}
        >
          {t("prompt.default")}
        </button>
        {items.map((item) => (
          <button
            key={`item_${item.id}`}
            type="button"
            className={`system-prompt-chip ${selectedKey === `item_${item.id}` ? "active" : ""}`}
            onClick={() => onSelect(selectedKey === `item_${item.id}` ? "" : `item_${item.id}`, item.content)}
            title={item.content}
          >
            {item.name}
          </button>
        ))}
        {combos.map((combo) => (
          <button
            key={`combo_${combo.id}`}
            type="button"
            className={`system-prompt-chip combo ${selectedKey === `combo_${combo.id}` ? "active" : ""}`}
            onClick={() => {
              const text = (combo.items || []).map((i) => i.content).join("\n\n");
              onSelect(selectedKey === `combo_${combo.id}` ? "" : `combo_${combo.id}`, text);
            }}
            title={(combo.items || []).map((i) => i.name).join(" → ")}
          >
            {combo.name}
            <span className="system-prompt-chip-count">{combo.items?.length || 0}</span>
          </button>
        ))}
        <button
          type="button"
          className="system-prompt-chip add-btn"
          onClick={onOpenSettings}
          title={t("prompt.manage")}
        >
          +
        </button>
      </div>
    </div>
  );
}
