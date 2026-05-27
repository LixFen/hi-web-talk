import React from "react";
import { useLocale } from "../contexts/LocaleContext";
import { LOCALE_OPTIONS } from "../lib/i18n";

export default function AppearanceSettingsPanel({
  open,
  settings = {},
  isSaving = false,
  onClose,
  onToggleShowChatFocusOutline,
  onToggleHideWideScreenSideBranches,
  onToggleDarkMode,
}) {
  const { locale, setLocale, t } = useLocale();

  if (!open) {
    return null;
  }

  const showChatFocusOutline = settings.showChatFocusOutline !== false;
  const hideWideScreenSideBranches = settings.hideWideScreenSideBranches === true;
  const darkMode = settings.darkMode || "system";
  const darkModeEnabled = darkMode === "dark";

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label={t("appearance.title")}>
      <div className="settings-modal appearance-settings-modal">
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <div>
              <div className="settings-eyebrow">{t("appearance.stage")}</div>
              <h2 className="settings-title">{t("appearance.title")}</h2>
            </div>
            <button type="button" className="topbar-btn subtle" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.35rem", verticalAlign: "-0.125rem" }}>
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
              {t("settings.back")}
            </button>
          </div>

          <p className="appearance-settings-summary">
            {t("appearance.summary")}
          </p>
        </div>

        <div className="settings-form">
          <div className="settings-form-header">
            <div>
              <div className="settings-eyebrow">{t("settings.stageAppearance")}</div>
              <h3 className="settings-panel-title">{t("appearance.panel")}</h3>
            </div>
          </div>

          <section className="settings-appearance-card" aria-label={t("appearance.focusOutline")}>
            <div>
              <h4 className="settings-appearance-card-title">{t("appearance.focusOutline")}</h4>
              <p className="settings-appearance-card-desc">
                {t("appearance.focusOutlineDesc")}
              </p>
            </div>

            <label className="settings-switch" htmlFor="show-chat-focus-outline-toggle">
              <input
                id="show-chat-focus-outline-toggle"
                type="checkbox"
                className="settings-switch-input"
                checked={showChatFocusOutline}
                disabled={isSaving}
                onChange={(event) => onToggleShowChatFocusOutline?.(event.target.checked)}
              />
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
              <span className="settings-switch-label">{showChatFocusOutline ? t("appearance.on") : t("appearance.off")}</span>
            </label>
          </section>

          <section className="settings-appearance-card" aria-label={t("appearance.sideBranches")}>
            <div>
              <h4 className="settings-appearance-card-title">{t("appearance.sideBranches")}</h4>
              <p className="settings-appearance-card-desc">
                {t("appearance.sideBranchesDesc")}
              </p>
            </div>

            <label className="settings-switch" htmlFor="hide-wide-screen-side-branches-toggle">
              <input
                id="hide-wide-screen-side-branches-toggle"
                type="checkbox"
                className="settings-switch-input"
                checked={hideWideScreenSideBranches}
                disabled={isSaving}
                onChange={(event) => onToggleHideWideScreenSideBranches?.(event.target.checked)}
              />
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
              <span className="settings-switch-label">
                {hideWideScreenSideBranches ? t("appearance.on") : t("appearance.off")}
              </span>
            </label>
          </section>

          <section className="settings-appearance-card" aria-label={t("appearance.darkMode")}>
            <div>
              <h4 className="settings-appearance-card-title">{t("appearance.darkMode")}</h4>
              <p className="settings-appearance-card-desc">
                {t("appearance.darkModeDesc")}
              </p>
            </div>

            <label className="settings-switch" htmlFor="dark-mode-toggle">
              <input
                id="dark-mode-toggle"
                type="checkbox"
                className="settings-switch-input"
                checked={darkModeEnabled}
                disabled={isSaving}
                onChange={(event) => onToggleDarkMode?.(event.target.checked ? "dark" : "system")}
              />
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
              <span className="settings-switch-label">{darkModeEnabled ? t("appearance.on") : t("appearance.followSystem")}</span>
            </label>
          </section>

          <section className="settings-appearance-card" aria-label={t("settings.language")}>
            <div>
              <h4 className="settings-appearance-card-title">{t("settings.language")}</h4>
            </div>

            <select
              className="composer-model-selector"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              aria-label={t("settings.language")}
            >
              {LOCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </section>
        </div>
      </div>
    </div>
  );
}
