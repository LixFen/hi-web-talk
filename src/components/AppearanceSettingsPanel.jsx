import React from "react";

export default function AppearanceSettingsPanel({
  open,
  settings = {},
  isSaving = false,
  onClose,
  onToggleShowChatFocusOutline,
  onToggleHideWideScreenSideBranches,
  onToggleDarkMode,
}) {
  if (!open) {
    return null;
  }

  const showChatFocusOutline = settings.showChatFocusOutline !== false;
  const hideWideScreenSideBranches = settings.hideWideScreenSideBranches === true;
  const darkMode = settings.darkMode || "system";
  const darkModeEnabled = darkMode === "dark";

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label="外观设置">
      <div className="settings-modal appearance-settings-modal">
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <div>
              <div className="settings-eyebrow">Stage 8</div>
              <h2 className="settings-title">外观设置</h2>
            </div>
            <button type="button" className="topbar-btn subtle" onClick={onClose}>
              关闭
            </button>
          </div>

          <p className="appearance-settings-summary">
            这里用于控制聊天区域的视觉细节，可根据个人阅读偏好进行开关调整。
          </p>
        </div>

        <div className="settings-form">
          <div className="settings-form-header">
            <div>
              <div className="settings-eyebrow">Appearance</div>
              <h3 className="settings-panel-title">聊天视图</h3>
            </div>
          </div>

          <section className="settings-appearance-card" aria-label="聊天视图焦点样式">
            <div>
              <h4 className="settings-appearance-card-title">显示聊天视图焦点轮廓</h4>
              <p className="settings-appearance-card-desc">
                开启后，当前焦点消息会高亮边框和阴影，便于在长对话中快速定位。
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
              <span className="settings-switch-label">{showChatFocusOutline ? "已开启" : "已关闭"}</span>
            </label>
          </section>

          <section className="settings-appearance-card" aria-label="聊天侧边分支显示">
            <div>
              <h4 className="settings-appearance-card-title">宽屏端隐藏直接显示对话列表两侧分支</h4>
              <p className="settings-appearance-card-desc">
                开启后将隐藏聊天列表两侧的分支预览文字，仅保留正文区域内的分支切换按钮。
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
                {hideWideScreenSideBranches ? "已开启" : "已关闭"}
              </span>
            </label>
          </section>

          <section className="settings-appearance-card" aria-label="深色模式">
            <div>
              <h4 className="settings-appearance-card-title">深色模式</h4>
              <p className="settings-appearance-card-desc">
                开启后强制使用深色主题，关闭后跟随系统设置。
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
              <span className="settings-switch-label">{darkModeEnabled ? "已开启" : "跟随系统"}</span>
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}
