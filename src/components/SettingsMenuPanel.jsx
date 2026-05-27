import React from "react";
import { useLocale } from "../contexts/LocaleContext";

export default function SettingsMenuPanel({ open, onClose, onSelectSection }) {
  const { t } = useLocale();
  const settingSections = [
    { key: "model", label: t("settings.section.model"), description: t("settings.section.modelDesc") },
    { key: "appearance", label: t("settings.section.appearance"), description: t("settings.section.appearanceDesc") },
    { key: "behavior", label: t("settings.section.behavior"), description: t("settings.section.behaviorDesc") },
    { key: "data", label: t("settings.section.data"), description: t("settings.section.dataDesc") },
    { key: "about", label: t("settings.section.about"), description: t("settings.section.aboutDesc") },
  ];

  if (!open) {
    return null;
  }

  return (
    <div className="settings-menu-backdrop" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
      <div className="settings-menu-modal">
        <div className="settings-menu-header">
          <div>
            <div className="settings-eyebrow">{t("settings.menuStage")}</div>
            <h2 className="settings-title">{t("settings.title")}</h2>
          </div>
          <button type="button" className="topbar-btn subtle" onClick={onClose}>
            {t("settings.back")}
          </button>
        </div>

        <div className="settings-menu-list" role="list">
          {settingSections.map((section) => {
            const isAvailableEntry =
              section.key === "model" ||
              section.key === "appearance" ||
              section.key === "behavior";

            return (
              <button
                key={section.key}
                type="button"
                className="settings-menu-item"
                role="listitem"
                disabled={!isAvailableEntry}
                onClick={() => {
                  if (!isAvailableEntry) {
                    return;
                  }

                  onSelectSection?.(section.key);
                }}
              >
                <span className="settings-menu-item-title">{section.label}</span>
                <span className="settings-menu-item-desc">{section.description}</span>
                <span className="settings-menu-item-tag">{isAvailableEntry ? t("settings.enter") : t("settings.unavailable")}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
