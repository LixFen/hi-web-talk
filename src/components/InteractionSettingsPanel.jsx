import React, { useState, useMemo } from "react";
import { useLocale } from "../contexts/LocaleContext";

function getChatViewAdaptationButtonSwitches(t) {
  return [
    {
      key: "showContextIgnoreButton",
      labelKey: "interaction.buttonIgnore",
      descriptionKey: "interaction.buttonIgnoreDesc",
    },
    {
      key: "showSummaryPreferButton",
      labelKey: "interaction.buttonPreferSummary",
      descriptionKey: "interaction.buttonPreferSummaryDesc",
    },
    {
      key: "showSummaryPinButton",
      labelKey: "interaction.buttonPinSummary",
      descriptionKey: "interaction.buttonPinSummaryDesc",
    },
    {
      key: "showSummaryGenerateButton",
      labelKey: "interaction.buttonGenerateSummary",
      descriptionKey: "interaction.buttonGenerateSummaryDesc",
    },
    {
      key: "showImportantLabelButton",
      labelKey: "interaction.buttonImportant",
      descriptionKey: "interaction.buttonImportantDesc",
    },
    {
      key: "showPendingOrganizeLabelButton",
      labelKey: "interaction.buttonReview",
      descriptionKey: "interaction.buttonReviewDesc",
    },
  ];
}

export default function InteractionSettingsPanel({
  open,
  settings = {},
  enabledModels = [],
  isSaving = false,
  isAdmin = false,
  onClose,
  onToggleShowChatAdaptationButtons,
  onToggleSingleChatAdaptationButton,
  onChangeTitleModel,
  onChangeSummaryModel,
  onUpdateInteractionSettings,
}) {
  const { t } = useLocale();
  const [activeLeaf, setActiveLeaf] = useState("chat-adaptation-buttons");
  const showChatAdaptationButtons = settings.showChatAdaptationButtons !== false;

  const chatViewAdaptationButtonSwitches = useMemo(
    () => getChatViewAdaptationButtonSwitches(t),
    [t]
  );

  const childSwitches = chatViewAdaptationButtonSwitches.map((item) => ({
    ...item,
    label: t(item.labelKey),
    description: t(item.descriptionKey),
    enabled: settings[item.key] !== false,
  }));

  const titleModelAlias = settings.titleModelAlias || "";
  const summaryModelAlias = settings.summaryModelAlias || "";

  if (!open) {
    return null;
  }

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label={t("interaction.title")}>
      <div className="settings-modal appearance-settings-modal">
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <div>
              <div className="settings-eyebrow">{t("interaction.stage")}</div>
              <h2 className="settings-title">{t("interaction.title")}</h2>
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
            {t("interaction.summary")}
          </p>

          <div className="settings-model-list" role="list" aria-label={t("interaction.title")}>
            <button
              type="button"
              role="listitem"
              className={`settings-model-item ${activeLeaf === "chat-adaptation-buttons" ? "active" : ""}`.trim()}
              onClick={() => setActiveLeaf("chat-adaptation-buttons")}
            >
              <span className="settings-model-name">{t("interaction.view")}</span>
              <span className="settings-model-meta">{t("interaction.buttonVisibility")}</span>
            </button>
            <button
              type="button"
              role="listitem"
              className={`settings-model-item ${activeLeaf === "interaction-model" ? "active" : ""}`.trim()}
              onClick={() => setActiveLeaf("interaction-model")}
            >
              <span className="settings-model-name">{t("interaction.modelConfig")}</span>
              <span className="settings-model-meta">{t("interaction.summaryModelDesc")}</span>
            </button>
            <button
              type="button"
              role="listitem"
              className={`settings-model-item ${activeLeaf === "search" ? "active" : ""}`.trim()}
              onClick={() => setActiveLeaf("search")}
            >
              <span className="settings-model-name">{t("interaction.searchConfig")}</span>
              <span className="settings-model-meta">{t("interaction.searchEngine")}</span>
            </button>
            {isAdmin && (
              <button
                type="button"
                role="listitem"
                className={`settings-model-item ${activeLeaf === "admin" ? "active" : ""}`.trim()}
                onClick={() => setActiveLeaf("admin")}
              >
                <span className="settings-model-name">{t("interaction.admin")}</span>
                <span className="settings-model-meta">{t("interaction.inviteCodeManagement")}</span>
              </button>
            )}
          </div>
        </div>

        <div className="settings-form">
          <div className="settings-form-header">
            <div>
              <div className="settings-eyebrow">{t("settings.stageInteraction")}</div>
              <h3 className="settings-panel-title">
                {activeLeaf === "interaction-model" ? t("interaction.modelConfig") : activeLeaf === "admin" ? t("interaction.admin") : activeLeaf === "search" ? t("interaction.searchConfig") : `${t("interaction.view")} / ${t("interaction.buttonVisibility")}`}
              </h3>
            </div>
          </div>

          {activeLeaf === "chat-adaptation-buttons" ? (
            <>
              <section className="settings-appearance-card" aria-label={t("interaction.showChatButtons")}>
                <div>
                  <h4 className="settings-appearance-card-title">{t("interaction.showChatButtons")}</h4>
                  <p className="settings-appearance-card-desc">
                    {t("interaction.showChatButtonsDesc")}
                  </p>
                </div>

                <label className="settings-switch" htmlFor="show-chat-adaptation-buttons-toggle">
                  <input
                    id="show-chat-adaptation-buttons-toggle"
                    type="checkbox"
                    className="settings-switch-input"
                    checked={showChatAdaptationButtons}
                    disabled={isSaving}
                    onChange={(event) => onToggleShowChatAdaptationButtons?.(event.target.checked)}
                  />
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                    <span className="settings-switch-label">
                      {showChatAdaptationButtons ? t("interaction.enabled") : t("interaction.disabled")}
                    </span>
                </label>
              </section>

              {showChatAdaptationButtons ? (
                childSwitches.map((item) => (
                  <section
                    key={item.key}
                    className="settings-appearance-card"
                    aria-label={`${t("interaction.buttonVisibility")}：${item.label}`}
                  >
                    <div>
                      <h4 className="settings-appearance-card-title">{item.label}</h4>
                      <p className="settings-appearance-card-desc">{item.description}</p>
                    </div>

                    <label className="settings-switch" htmlFor={`interaction-switch-${item.key}`}>
                      <input
                        id={`interaction-switch-${item.key}`}
                        type="checkbox"
                        className="settings-switch-input"
                        checked={item.enabled}
                        disabled={isSaving}
                        onChange={(event) =>
                          onToggleSingleChatAdaptationButton?.(item.key, event.target.checked)
                        }
                      />
                      <span className="settings-switch-track" aria-hidden="true">
                        <span className="settings-switch-thumb" />
                      </span>
                      <span className="settings-switch-label">{item.enabled ? t("interaction.show") : t("interaction.hide")}</span>
                    </label>
                  </section>
                ))
              ) : null}
            </>
          ) : null}

          {activeLeaf === "interaction-model" ? (
            <>
              <section className="settings-appearance-card" aria-label={t("interaction.titleModel")}>
                <div>
                  <h4 className="settings-appearance-card-title">{t("interaction.titleModel")}</h4>
                  <p className="settings-appearance-card-desc">
                    {t("interaction.titleModelDesc")}
                  </p>
                </div>

                <select
                  className="composer-model-selector"
                  value={titleModelAlias}
                  onChange={(e) => onChangeTitleModel?.(e.target.value)}
                  disabled={isSaving}
                  aria-label={t("interaction.titleModel")}
                >
                  <option value="">{t("interaction.autoSelect")}</option>
                  {enabledModels.map((option) => (
                    <option key={option.alias} value={option.alias}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </section>

              <section className="settings-appearance-card" aria-label={t("interaction.autoGenerateTitle")}>
                <div>
                  <h4 className="settings-appearance-card-title">{t("interaction.autoGenerateTitle")}</h4>
                  <p className="settings-appearance-card-desc">
                    {t("interaction.autoGenerateTitleDesc")}
                  </p>
                </div>

                <label className="settings-switch" htmlFor="auto-generate-title-toggle">
                  <input
                    id="auto-generate-title-toggle"
                    type="checkbox"
                    className="settings-switch-input"
                    checked={settings.autoGenerateTitle !== false}
                    disabled={isSaving}
                    onChange={(event) =>
                      onUpdateInteractionSettings?.({ autoGenerateTitle: event.target.checked })
                    }
                  />
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                  <span className="settings-switch-label">
                    {settings.autoGenerateTitle !== false ? t("interaction.enabled") : t("interaction.disabled")}
                  </span>
                </label>
              </section>

              <section className="settings-appearance-card" aria-label={t("interaction.summaryModel")}>
                <div>
                  <h4 className="settings-appearance-card-title">{t("interaction.summaryModel")}</h4>
                  <p className="settings-appearance-card-desc">
                    {t("interaction.summaryModelDesc")}
                  </p>
                </div>

                <select
                  className="composer-model-selector"
                  value={summaryModelAlias}
                  onChange={(e) => onChangeSummaryModel?.(e.target.value)}
                  disabled={isSaving}
                  aria-label={t("interaction.summaryModel")}
                >
                  <option value="">{t("interaction.autoSelect")}</option>
                  {enabledModels.map((option) => (
                    <option key={option.alias} value={option.alias}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </section>
            </>
          ) : null}

          {activeLeaf === "search" ? (
            <SearchConfigPanel
              settings={settings}
              isSaving={isSaving}
              onUpdate={onUpdateInteractionSettings}
              t={t}
            />
          ) : null}

          {activeLeaf === "admin" ? (
            <>
              <section className="settings-appearance-card" aria-label={t("interaction.inviteCodeRequired")}>
                <div>
                  <h4 className="settings-appearance-card-title">{t("interaction.inviteCodeRequired")}</h4>
                  <p className="settings-appearance-card-desc">
                    {t("interaction.inviteCodeRequiredDesc")}
                  </p>
                </div>

                <label className="settings-switch" htmlFor="invite-code-required-toggle">
                  <input
                    id="invite-code-required-toggle"
                    type="checkbox"
                    className="settings-switch-input"
                    checked={settings.inviteCodeRequired === true}
                    disabled={isSaving}
                    onChange={(event) =>
                      onUpdateInteractionSettings?.({ inviteCodeRequired: event.target.checked })
                    }
                  />
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                  <span className="settings-switch-label">
                    {settings.inviteCodeRequired === true ? t("interaction.enabled") : t("interaction.disabled")}
                  </span>
                </label>
              </section>

              {settings.inviteCodeRequired && (
                <section className="settings-appearance-card" aria-label={t("interaction.inviteCodeLabel")}>
                  <div>
                    <h4 className="settings-appearance-card-title">{t("interaction.inviteCodeLabel")}</h4>
                    <p className="settings-appearance-card-desc">
                      {t("interaction.inviteCodeRequiredDesc")}
                    </p>
                  </div>

                  <input
                    type="text"
                    className="composer-model-selector"
                    style={{ maxWidth: 280 }}
                    placeholder={t("interaction.inviteCodePlaceholder")}
                    defaultValue={settings.inviteCode || ""}
                    disabled={isSaving}
                    onBlur={(event) => {
                      const code = event.target.value.trim();
                      onUpdateInteractionSettings?.(
                        code
                          ? { inviteCode: code }
                          : { inviteCode: "", inviteCodeRequired: false },
                      );
                    }}
                  />
                </section>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SearchConfigPanel({ settings, isSaving, onUpdate, t }) {
  const providerConfigs = settings.searchProviderConfigs || {};
  const [draft, setDraft] = React.useState(providerConfigs);
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(providerConfigs);

  const save = () => {
    if (hasChanges) onUpdate?.({ searchProviderConfigs: draft });
  };

  const setVal = (engine, key, val) => {
    setDraft((prev) => ({
      ...prev,
      [engine]: { ...(prev[engine] || {}), [key]: val },
    }));
  };

  return (
    <>
      <section className="settings-appearance-card" aria-label={t("interaction.searchConfig")}>
        <div>
          <h4 className="settings-appearance-card-title">{t("interaction.searchEngine")}</h4>
          <p className="settings-appearance-card-desc">{t("interaction.searchEngineDesc")}</p>
        </div>
        <select
          className="composer-model-selector"
          value={settings.searchEngine || "bing_html"}
          onChange={(e) => onUpdate?.({ searchEngine: e.target.value })}
          disabled={isSaving}
          aria-label={t("interaction.searchEngine")}
        >
          <option value="bing_html">{t("interaction.engine_bing_html")}</option>
          <option value="brave">{t("interaction.engine_brave")}</option>
          <option value="bing">{t("interaction.engine_bing")}</option>
          <option value="google">{t("interaction.engine_google")}</option>
          <option value="searxng">{t("interaction.engine_searxng")}</option>
        </select>
      </section>

      <section className="settings-appearance-card" aria-label={t("interaction.searchSourcesCollapsed")}>
        <div>
          <h4 className="settings-appearance-card-title">{t("interaction.searchSourcesCollapsed")}</h4>
          <p className="settings-appearance-card-desc">{t("interaction.searchSourcesCollapsedDesc")}</p>
        </div>
        <label className="settings-switch" htmlFor="search-sources-collapsed-toggle">
          <input
            id="search-sources-collapsed-toggle"
            type="checkbox"
            className="settings-switch-input"
            checked={settings.searchSourcesCollapsed !== false}
            disabled={isSaving}
            onChange={(event) => onUpdate?.({ searchSourcesCollapsed: event.target.checked })}
          />
          <span className="settings-switch-track" aria-hidden="true">
            <span className="settings-switch-thumb" />
          </span>
          <span className="settings-switch-label">
            {settings.searchSourcesCollapsed !== false ? t("interaction.enabled") : t("interaction.disabled")}
          </span>
        </label>
      </section>

      <section className="settings-appearance-card">
        <div>
          <h4 className="settings-appearance-card-title">{t("interaction.engineConfig")}</h4>
          <p className="settings-appearance-card-desc">{t("interaction.engineConfigDesc")}</p>
        </div>
      </section>

      {/* Brave */}
      <section className="settings-appearance-card">
        <div>
          <h4 className="settings-appearance-card-title">{t("interaction.engine_brave")}</h4>
          <p className="settings-appearance-card-desc">{t("interaction.braveApiKeyDesc")}</p>
        </div>
        <input
          type="password"
          className="composer-model-selector"
          style={{ maxWidth: 320 }}
          placeholder={t("interaction.braveApiKey")}
          value={draft.brave?.apiKey || ""}
          disabled={isSaving}
          onChange={(e) => setVal("brave", "apiKey", e.target.value)}
          onBlur={save}
        />
      </section>

      {/* Bing API */}
      <section className="settings-appearance-card">
        <div>
          <h4 className="settings-appearance-card-title">{t("interaction.engine_bing")}</h4>
          <p className="settings-appearance-card-desc">{t("interaction.bingApiKeyDesc")}</p>
        </div>
        <input
          type="password"
          className="composer-model-selector"
          style={{ maxWidth: 320 }}
          placeholder={t("interaction.bingApiKey")}
          value={draft.bing?.apiKey || ""}
          disabled={isSaving}
          onChange={(e) => setVal("bing", "apiKey", e.target.value)}
          onBlur={save}
        />
      </section>

      {/* Google */}
      <section className="settings-appearance-card">
        <div>
          <h4 className="settings-appearance-card-title">{t("interaction.engine_google")}</h4>
          <p className="settings-appearance-card-desc">{t("interaction.googleApiKeyDesc")}</p>
        </div>
        <input
          type="password"
          className="composer-model-selector"
          style={{ maxWidth: 320 }}
          placeholder={t("interaction.googleApiKey")}
          value={draft.google?.apiKey || ""}
          disabled={isSaving}
          onChange={(e) => setVal("google", "apiKey", e.target.value)}
          onBlur={save}
        />
        <div style={{ height: 8 }} />
        <input
          type="text"
          className="composer-model-selector"
          style={{ maxWidth: 320 }}
          placeholder={t("interaction.googleCseId")}
          value={draft.google?.cseId || ""}
          disabled={isSaving}
          onChange={(e) => setVal("google", "cseId", e.target.value)}
          onBlur={save}
        />
      </section>

      {/* SearXNG */}
      <section className="settings-appearance-card">
        <div>
          <h4 className="settings-appearance-card-title">{t("interaction.engine_searxng")}</h4>
          <p className="settings-appearance-card-desc">{t("interaction.searxngUrlDesc")}</p>
        </div>
        <input
          type="text"
          className="composer-model-selector"
          style={{ maxWidth: 320 }}
          placeholder={t("interaction.searxngUrl")}
          value={draft.searxng?.baseUrl || ""}
          disabled={isSaving}
          onChange={(e) => setVal("searxng", "baseUrl", e.target.value)}
          onBlur={save}
        />
      </section>
    </>
  );
}
