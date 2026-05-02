import React, { useState } from "react";

const CHAT_VIEW_ADAPTATION_BUTTON_SWITCHES = [
  {
    key: "showContextIgnoreButton",
    label: "忽略上下文",
    description: "控制「忽略上下文」按钮是否显示。",
  },
  {
    key: "showSummaryPreferButton",
    label: "优先摘要",
    description: "控制「优先摘要」按钮是否显示。",
  },
  {
    key: "showSummaryPinButton",
    label: "固定摘要",
    description: "控制「固定摘要」按钮是否显示。",
  },
  {
    key: "showSummaryGenerateButton",
    label: "生成摘要",
    description: "控制「生成摘要」按钮是否显示。",
  },
  {
    key: "showImportantLabelButton",
    label: "重要",
    description: "控制「重要」标签按钮是否显示。",
  },
  {
    key: "showPendingOrganizeLabelButton",
    label: "待整理",
    description: "控制「待整理」标签按钮是否显示。",
  },
];

export default function InteractionSettingsPanel({
  open,
  settings = {},
  enabledModels = [],
  isSaving = false,
  onClose,
  onToggleShowChatAdaptationButtons,
  onToggleSingleChatAdaptationButton,
  onChangeTitleModel,
  onChangeSummaryModel,
}) {
  const [activeLeaf, setActiveLeaf] = useState("chat-adaptation-buttons");
  const showChatAdaptationButtons = settings.showChatAdaptationButtons !== false;
  const childSwitches = CHAT_VIEW_ADAPTATION_BUTTON_SWITCHES.map((item) => ({
    ...item,
    enabled: settings[item.key] !== false,
  }));
  const titleModelAlias = settings.titleModelAlias || "";
  const summaryModelAlias = settings.summaryModelAlias || "";

  if (!open) {
    return null;
  }

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label="交互设置">
      <div className="settings-modal appearance-settings-modal">
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <div>
              <div className="settings-eyebrow">Stage 9</div>
              <h2 className="settings-title">交互设置</h2>
            </div>
            <button type="button" className="topbar-btn subtle" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.35rem", verticalAlign: "-0.125rem" }}>
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
              返回
            </button>
          </div>

          <p className="appearance-settings-summary">
            管理聊天视图中交互控件的可见性与专用模型选择。
          </p>

          <div className="settings-model-list" role="list" aria-label="交互设置三级菜单">
            <button
              type="button"
              role="listitem"
              className={`settings-model-item ${activeLeaf === "chat-adaptation-buttons" ? "active" : ""}`.trim()}
              onClick={() => setActiveLeaf("chat-adaptation-buttons")}
            >
              <span className="settings-model-name">聊天视图</span>
              <span className="settings-model-meta">适配按钮显示</span>
            </button>
            <button
              type="button"
              role="listitem"
              className={`settings-model-item ${activeLeaf === "interaction-model" ? "active" : ""}`.trim()}
              onClick={() => setActiveLeaf("interaction-model")}
            >
              <span className="settings-model-name">交互模型配置</span>
              <span className="settings-model-meta">标题与摘要专用模型</span>
            </button>
          </div>
        </div>

        <div className="settings-form">
          <div className="settings-form-header">
            <div>
              <div className="settings-eyebrow">Interaction</div>
              <h3 className="settings-panel-title">
                {activeLeaf === "interaction-model" ? "交互模型配置" : "聊天视图 / 适配按钮显示"}
              </h3>
            </div>
          </div>

          {activeLeaf === "chat-adaptation-buttons" ? (
            <>
              <section className="settings-appearance-card" aria-label="适配按钮总开关">
                <div>
                  <h4 className="settings-appearance-card-title">显示聊天适配按钮</h4>
                  <p className="settings-appearance-card-desc">
                    关闭后，聊天视图将隐藏「忽略上下文、优先摘要、固定摘要、生成摘要、重要、待整理」按钮。
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
                    {showChatAdaptationButtons ? "已开启" : "已关闭"}
                  </span>
                </label>
              </section>

              {showChatAdaptationButtons ? (
                childSwitches.map((item) => (
                  <section
                    key={item.key}
                    className="settings-appearance-card"
                    aria-label={`按钮开关：${item.label}`}
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
                      <span className="settings-switch-label">{item.enabled ? "显示" : "隐藏"}</span>
                    </label>
                  </section>
                ))
              ) : null}
            </>
          ) : null}

          {activeLeaf === "interaction-model" ? (
            <>
              <section className="settings-appearance-card" aria-label="标题生成模型">
                <div>
                  <h4 className="settings-appearance-card-title">标题生成模型</h4>
                  <p className="settings-appearance-card-desc">
                    右键会话列表中的会话，选择「重新生成标题」或「根据重要程度生成标题」时将使用此模型。
                  </p>
                </div>

                <select
                  className="composer-model-selector"
                  value={titleModelAlias}
                  onChange={(e) => onChangeTitleModel?.(e.target.value)}
                  disabled={isSaving}
                  aria-label="选择标题生成模型"
                >
                  <option value="">自动选择</option>
                  {enabledModels.map((option) => (
                    <option key={option.alias} value={option.alias}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </section>

              <section className="settings-appearance-card" aria-label="摘要模型">
                <div>
                  <h4 className="settings-appearance-card-title">摘要模型</h4>
                  <p className="settings-appearance-card-desc">
                    为对话块生成内容摘要时将使用此模型。
                  </p>
                </div>

                <select
                  className="composer-model-selector"
                  value={summaryModelAlias}
                  onChange={(e) => onChangeSummaryModel?.(e.target.value)}
                  disabled={isSaving}
                  aria-label="选择摘要模型"
                >
                  <option value="">自动选择</option>
                  {enabledModels.map((option) => (
                    <option key={option.alias} value={option.alias}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
