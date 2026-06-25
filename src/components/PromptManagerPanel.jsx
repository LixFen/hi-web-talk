import React, { useState, useMemo } from "react";
import { useLocale } from "../contexts/LocaleContext";
import { useApp } from "../contexts/AppContext";

const TAB_ITEMS = "items";
const TAB_COMBOS = "combos";

function clampText(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

export default function PromptManagerPanel({ open, onClose }) {
  const { t } = useLocale();
  const {
    promptItems,
    promptCombos,
    isPromptSaving,
    createPromptItem,
    updatePromptItem,
    deletePromptItem,
    createPromptCombo,
    updatePromptCombo,
    deletePromptCombo,
    showToast,
  } = useApp();

  const [tab, setTab] = useState(TAB_ITEMS);
  const [editingItem, setEditingItem] = useState(null); // null | "new" | item object
  const [editingCombo, setEditingCombo] = useState(null);

  // Item form state
  const [itemName, setItemName] = useState("");
  const [itemContent, setItemContent] = useState("");

  // Combo form state
  const [comboName, setComboName] = useState("");
  const [comboIsDefault, setComboIsDefault] = useState(false);
  const [comboItemIds, setComboItemIds] = useState([]);

  if (!open) return null;

  function resetItemForm() {
    setEditingItem(null);
    setItemName("");
    setItemContent("");
  }

  function resetComboForm() {
    setEditingCombo(null);
    setComboName("");
    setComboIsDefault(false);
    setComboItemIds([]);
  }

  function startEditItem(item) {
    setEditingItem(item);
    setItemName(item.name);
    setItemContent(item.content);
  }

  function startNewItem() {
    setEditingItem("new");
    setItemName("");
    setItemContent("");
  }

  function startEditCombo(combo) {
    setEditingCombo(combo);
    setComboName(combo.name);
    setComboIsDefault(!!combo.isDefault);
    setComboItemIds((combo.items || []).map((i) => i.id));
  }

  function startNewCombo() {
    setEditingCombo("new");
    setComboName("");
    setComboIsDefault(false);
    setComboItemIds([]);
  }

  function toggleComboItemId(id) {
    setComboItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function moveComboItem(index, dir) {
    setComboItemIds((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSaveItem() {
    if (!itemName.trim() || !itemContent.trim()) {
      showToast(t("prompt.fillRequired"), "error");
      return;
    }
    try {
      if (editingItem === "new") {
        await createPromptItem(itemName.trim(), itemContent.trim());
      } else {
        await updatePromptItem(editingItem.id, itemName.trim(), itemContent.trim());
      }
      resetItemForm();
      showToast(t("prompt.saved"));
    } catch {
      showToast(t("prompt.saveFailed"), "error");
    }
  }

  async function handleDeleteItem(item) {
    if (!window.confirm(t("prompt.confirmDeleteItem", { name: item.name }))) return;
    try {
      await deletePromptItem(item.id);
      if (editingItem?.id === item.id) resetItemForm();
      showToast(t("prompt.deleted"));
    } catch {
      showToast(t("prompt.deleteFailed"), "error");
    }
  }

  async function handleSaveCombo() {
    if (!comboName.trim()) {
      showToast(t("prompt.fillRequired"), "error");
      return;
    }
    try {
      if (editingCombo === "new") {
        await createPromptCombo(comboName.trim(), comboIsDefault, comboItemIds);
      } else {
        await updatePromptCombo(editingCombo.id, comboName.trim(), comboIsDefault, comboItemIds);
      }
      resetComboForm();
      showToast(t("prompt.saved"));
    } catch {
      showToast(t("prompt.saveFailed"), "error");
    }
  }

  async function handleDeleteCombo(combo) {
    if (!window.confirm(t("prompt.confirmDeleteCombo", { name: combo.name }))) return;
    try {
      await deletePromptCombo(combo.id);
      if (editingCombo?.id === combo.id) resetComboForm();
      showToast(t("prompt.deleted"));
    } catch {
      showToast(t("prompt.deleteFailed"), "error");
    }
  }

  const renderItemList = () => (
    <div className="settings-sidebar">
      <div className="settings-sidebar-header">
        <div>
          <div className="settings-eyebrow">{t("prompt.stage")}</div>
          <h2 className="settings-title">{t("prompt.items")}</h2>
        </div>
        <button type="button" className="topbar-btn subtle" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.35rem", verticalAlign: "-0.125rem" }}>
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          {t("settings.back")}
        </button>
      </div>
      <button type="button" className="settings-primary-btn" onClick={startNewItem}>
        {t("prompt.newItem")}
      </button>
      <div className="settings-model-list">
        {promptItems.length === 0 && (
          <div className="settings-tree-empty">{t("prompt.noItems")}</div>
        )}
        {promptItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-model-item ${editingItem?.id === item.id ? "active" : ""}`}
            onClick={() => startEditItem(item)}
          >
            <span className="settings-model-name">{item.name}</span>
            <span className="settings-model-meta">{clampText(item.content, 60)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderItemForm = () => (
    <div className="settings-form">
      <div className="settings-form-header">
        <div>
          <div className="settings-eyebrow">{editingItem === "new" ? t("prompt.create") : t("prompt.edit")}</div>
          <h3 className="settings-panel-title">
            {editingItem === "new" ? t("prompt.newItem") : editingItem.name}
          </h3>
        </div>
      </div>
      <div className="settings-grid">
        <label className="settings-field settings-field-wide">
          <span>{t("prompt.itemName")}</span>
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder={t("prompt.itemNamePlaceholder")} />
        </label>
        <label className="settings-field settings-field-wide">
          <span>{t("prompt.itemContent")} ({itemContent.length}/2000)</span>
          <textarea
            value={itemContent}
            onChange={(e) => setItemContent(e.target.value)}
            placeholder={t("prompt.itemContentPlaceholder")}
            rows={6}
            style={{ resize: "vertical", fontFamily: "inherit", fontSize: "inherit", padding: "0.5rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", background: "var(--bg-main)" }}
          />
        </label>
      </div>
      <div className="settings-actions">
        <button type="button" className="settings-danger-btn" onClick={() => { if (editingItem !== "new") handleDeleteItem(editingItem); else resetItemForm(); }} disabled={isPromptSaving}>
          {editingItem === "new" ? t("prompt.cancel") : t("prompt.delete")}
        </button>
        <button type="button" className="settings-primary-btn" onClick={handleSaveItem} disabled={isPromptSaving}>
          {isPromptSaving ? t("prompt.saving") : t("prompt.save")}
        </button>
      </div>
    </div>
  );

  const renderComboList = () => (
    <div className="settings-sidebar">
      <div className="settings-sidebar-header">
        <div>
          <div className="settings-eyebrow">{t("prompt.stage")}</div>
          <h2 className="settings-title">{t("prompt.combos")}</h2>
        </div>
        <button type="button" className="topbar-btn subtle" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.35rem", verticalAlign: "-0.125rem" }}>
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          {t("settings.back")}
        </button>
      </div>
      <button type="button" className="settings-primary-btn" onClick={startNewCombo}>
        {t("prompt.newCombo")}
      </button>
      <div className="settings-model-list">
        {promptCombos.length === 0 && (
          <div className="settings-tree-empty">{t("prompt.noCombos")}</div>
        )}
        {promptCombos.map((combo) => (
          <button
            key={combo.id}
            type="button"
            className={`settings-model-item ${editingCombo?.id === combo.id ? "active" : ""}`}
            onClick={() => startEditCombo(combo)}
          >
            <span className="settings-model-name">
              {combo.name}
              {combo.isDefault ? ` ★` : ""}
            </span>
            <span className="settings-model-meta">{combo.items?.length || 0} {t("prompt.itemsCount")}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderComboForm = () => (
    <div className="settings-form">
      <div className="settings-form-header">
        <div>
          <div className="settings-eyebrow">{editingCombo === "new" ? t("prompt.create") : t("prompt.edit")}</div>
          <h3 className="settings-panel-title">
            {editingCombo === "new" ? t("prompt.newCombo") : editingCombo.name}
          </h3>
        </div>
      </div>
      <div className="settings-grid">
        <label className="settings-field settings-field-wide">
          <span>{t("prompt.comboName")}</span>
          <input value={comboName} onChange={(e) => setComboName(e.target.value)} placeholder={t("prompt.comboNamePlaceholder")} />
        </label>
        <label className="settings-toggle-row settings-field-wide">
          <input type="checkbox" checked={comboIsDefault} onChange={(e) => setComboIsDefault(e.target.checked)} />
          <span>{t("prompt.setDefault")}</span>
        </label>
      </div>

      <div className="settings-eyebrow" style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>{t("prompt.selectItems")}</div>
      <div className="settings-model-list" style={{ maxHeight: "300px", overflowY: "auto" }}>
        {promptItems.length === 0 && (
          <div className="settings-tree-empty">{t("prompt.noItems")}</div>
        )}
        {promptItems.map((item) => (
          <label key={item.id} className="settings-model-item" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={comboItemIds.includes(item.id)}
              onChange={() => toggleComboItemId(item.id)}
              style={{ flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="settings-model-name">{item.name}</span>
              <span className="settings-model-meta">{clampText(item.content, 50)}</span>
            </div>
          </label>
        ))}
      </div>

      {comboItemIds.length > 0 && (
        <>
          <div className="settings-eyebrow" style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>{t("prompt.orderedItems")}</div>
          <div className="settings-model-list" style={{ maxHeight: "200px", overflowY: "auto" }}>
            {comboItemIds.map((id, index) => {
              const item = promptItems.find((i) => i.id === id);
              if (!item) return null;
              return (
                <div key={id} className="settings-model-item" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <span style={{ color: "var(--muted)", fontSize: "0.75rem", minWidth: "1.2rem" }}>{index + 1}.</span>
                  <span className="settings-model-name" style={{ flex: 1 }}>{item.name}</span>
                  <button type="button" className="topbar-btn subtle" style={{ padding: "0.15rem 0.4rem", fontSize: "0.75rem" }} disabled={index === 0} onClick={() => moveComboItem(index, -1)}>↑</button>
                  <button type="button" className="topbar-btn subtle" style={{ padding: "0.15rem 0.4rem", fontSize: "0.75rem" }} disabled={index === comboItemIds.length - 1} onClick={() => moveComboItem(index, 1)}>↓</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="settings-actions">
        <button type="button" className="settings-danger-btn" onClick={() => { if (editingCombo !== "new") handleDeleteCombo(editingCombo); else resetComboForm(); }} disabled={isPromptSaving}>
          {editingCombo === "new" ? t("prompt.cancel") : t("prompt.delete")}
        </button>
        <button type="button" className="settings-primary-btn" onClick={handleSaveCombo} disabled={isPromptSaving}>
          {isPromptSaving ? t("prompt.saving") : t("prompt.save")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal model-settings-modal" style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}>
        {/* Tab switcher — spans both columns */}
        <div style={{ gridColumn: "1 / -1", display: "flex", borderBottom: "1px solid var(--border-color)" }}>
          <button
            type="button"
            onClick={() => { setTab(TAB_ITEMS); resetItemForm(); resetComboForm(); }}
            style={{
              flex: 1, padding: "0.75rem", border: "none", cursor: "pointer",
              background: tab === TAB_ITEMS ? "var(--bg-elevated)" : "transparent",
              fontWeight: tab === TAB_ITEMS ? 600 : 400,
              borderBottom: tab === TAB_ITEMS ? "2px solid var(--accent-color)" : "2px solid transparent",
              color: tab === TAB_ITEMS ? "var(--accent-color)" : "var(--text-secondary)",
            }}
          >
            {t("prompt.items")}
          </button>
          <button
            type="button"
            onClick={() => { setTab(TAB_COMBOS); resetItemForm(); resetComboForm(); }}
            style={{
              flex: 1, padding: "0.75rem", border: "none", cursor: "pointer",
              background: tab === TAB_COMBOS ? "var(--bg-elevated)" : "transparent",
              fontWeight: tab === TAB_COMBOS ? 600 : 400,
              borderBottom: tab === TAB_COMBOS ? "2px solid var(--accent-color)" : "2px solid transparent",
              color: tab === TAB_COMBOS ? "var(--accent-color)" : "var(--text-secondary)",
            }}
          >
            {t("prompt.combos")}
          </button>
        </div>

        {/* Content */}
        {tab === TAB_ITEMS && renderItemList()}
        {tab === TAB_COMBOS && renderComboList()}
        {tab === TAB_ITEMS && editingItem && renderItemForm()}
        {tab === TAB_COMBOS && editingCombo && renderComboForm()}
        {tab === TAB_ITEMS && !editingItem && (
          <div className="settings-form" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
            <p>{t("prompt.noItems")}</p>
          </div>
        )}
        {tab === TAB_COMBOS && !editingCombo && (
          <div className="settings-form" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
            <p>{t("prompt.noCombos")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
