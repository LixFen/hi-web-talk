import React from "react";

const SETTING_SECTIONS = [
  { key: "model", label: "模型设置", description: "管理模型与 Provider 配置" },
  { key: "appearance", label: "外观设置", description: "主题、字号与布局偏好" },
  { key: "behavior", label: "交互设置", description: "聊天与分支交互行为" },
  { key: "data", label: "数据管理", description: "会话导入导出与清理" },
  { key: "about", label: "关于与版本", description: "版本信息与更新说明" },
];

export default function SettingsMenuPanel({ open, onClose, onSelectSection }) {
  if (!open) {
    return null;
  }

  return (
    <div className="settings-menu-backdrop" role="dialog" aria-modal="true" aria-label="设置列表">
      <div className="settings-menu-modal">
        <div className="settings-menu-header">
          <div>
            <div className="settings-eyebrow">Settings</div>
            <h2 className="settings-title">设置</h2>
          </div>
          <button type="button" className="topbar-btn subtle" onClick={onClose}>
            返回
          </button>
        </div>

        <div className="settings-menu-list" role="list">
          {SETTING_SECTIONS.map((section) => {
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
                <span className="settings-menu-item-tag">{isAvailableEntry ? "进入" : "暂未开放"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
