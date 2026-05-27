import React from "react";
import { useLocale } from "../contexts/LocaleContext";
import { APP_VERSION } from "../lib/appVersion";
import SafeMarkdown from "./SafeMarkdown";
import changelogMarkdown from "../content/changelog.md?raw";

export default function AboutSettingsPanel({ open, onClose }) {
  const { t } = useLocale();

  if (!open) {
    return null;
  }

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label={t("about.title")}>
      <div className="settings-modal about-settings-modal">
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <div>
              <div className="settings-eyebrow">{t("about.stage")}</div>
              <h2 className="settings-title">{t("about.title")}</h2>
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
            {t("about.summary")}
          </p>

          <div className="settings-about-version-badge">
            <span>{t("about.versionLabel")}</span>
            <strong>{APP_VERSION}</strong>
          </div>
        </div>

        <div className="settings-form">
          <div className="settings-form-header">
            <div>
              <div className="settings-eyebrow">{t("about.stage")}</div>
              <h3 className="settings-panel-title">{t("about.title")}</h3>
            </div>
          </div>

          <section className="settings-appearance-card settings-about-card" aria-label={t("about.versionCard")}>
            <div>
              <h4 className="settings-appearance-card-title">{t("about.versionCard")}</h4>
              <p className="settings-appearance-card-desc">
                {t("about.versionDesc")}
              </p>
            </div>

            <div className="settings-about-version-pill" aria-label={t("about.versionLabel")}>
              {APP_VERSION}
            </div>
          </section>

          <section className="settings-appearance-card settings-about-card settings-about-changelog-card" aria-label={t("about.changelog")}>
            <div className="settings-about-changelog-header">
              <div>
                <h4 className="settings-appearance-card-title">{t("about.changelog")}</h4>
                <p className="settings-appearance-card-desc">
                  {t("about.changelogDesc")}
                </p>
              </div>
            </div>

            <div className="settings-about-changelog-markdown">
              <SafeMarkdown>{changelogMarkdown}</SafeMarkdown>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}