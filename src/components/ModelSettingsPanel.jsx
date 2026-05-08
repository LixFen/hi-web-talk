import { useEffect, useState } from "react";

function buildEmptyDraft(providerDefinitions) {
  const firstProvider = providerDefinitions[0];

  return {
    alias: "",
    label: "",
    providerType: firstProvider?.key || "openai-chat-completions",
    baseURL: firstProvider?.defaultBaseURL || "",
    apiKeySource: "env",
    apiKeyEnvName: firstProvider?.defaultEnvKeyName || "OPENAI_API_KEY",
    apiKey: "",
    modelName: "",
    enabled: true,
    supportsStreaming: true,
    supportsSystemRole: firstProvider?.supportsSystemRole !== false,
    supportsMultimodal: firstProvider?.supportsMultimodal !== false,
    thinkingDisableKey: getThinkingDisableKey(firstProvider?.thinkingDisableConfig ?? null),
    supportsThinking: resolveSupportsThinking(
      getThinkingDisableKey(firstProvider?.thinkingDisableConfig ?? null),
      firstProvider?.supportsThinking !== false,
    ),
    systemPromptRole: firstProvider?.defaultSystemPromptRole || "system",
    requestOptions: {
      reasoningEffort: firstProvider?.defaultRequestOptions?.reasoningEffort || "",
      thinkingBudgetTokens: firstProvider?.defaultRequestOptions?.thinkingBudgetTokens ?? 1024,
      thinkingBudget: firstProvider?.defaultRequestOptions?.thinkingBudget ?? 0,
      thinkingLevel: firstProvider?.defaultRequestOptions?.thinkingLevel || "",
      enableThinking: firstProvider?.defaultRequestOptions?.enableThinking ?? false,
      clearThinking: firstProvider?.defaultRequestOptions?.clearThinking ?? false,
    },
  };
}

function mapModelToDraft(model) {
  return {
    alias: model.alias,
    label: model.label,
    providerType: model.providerType,
    baseURL: model.baseURL || "",
    apiKeySource: model.apiKeySource || "env",
    apiKeyEnvName: model.apiKeyEnvName || "OPENAI_API_KEY",
    apiKey: "",
    modelName: model.modelName,
    enabled: model.enabled !== false,
    supportsStreaming: model.supportsStreaming !== false,
    supportsSystemRole: model.supportsSystemRole !== false,
    supportsMultimodal: model.supportsMultimodal !== false,
    thinkingDisableKey: getThinkingDisableKey(model.thinkingDisable ?? null),
    supportsThinking: model.supportsThinking !== false,
    systemPromptRole: model.systemPromptRole || "system",
    requestOptions: {
      reasoningEffort: model.requestOptions?.reasoningEffort || "",
      thinkingBudgetTokens: model.requestOptions?.thinkingBudgetTokens ?? 1024,
      thinkingBudget: model.requestOptions?.thinkingBudget ?? 0,
      thinkingLevel: model.requestOptions?.thinkingLevel || "",
      enableThinking: model.requestOptions?.enableThinking ?? false,
      clearThinking: model.requestOptions?.clearThinking ?? false,
    },
    shared: model.shared || false,
  };
}

function getCredentialText(model) {
  if (!model) {
    return "";
  }

  if (model.apiKeySource === "stored") {
    return model.hasStoredApiKey ? "已保存本地 Key" : "未保存本地 Key";
  }

  return model.credentialStatus === "configured"
    ? `读取环境变量 ${model.apiKeyEnvName}`
    : `缺少环境变量 ${model.apiKeyEnvName}`;
}

const THINKING_DISABLE_OPTIONS = [
  { key: "", label: "不发送（使用模型默认行为）", config: null, enablesThinking: null },
  { key: "enable_thinking:true", label: 'enable_thinking = true（extra_body={"enable_thinking":true}）', config: { param: "enable_thinking", value: true }, enablesThinking: true },
  { key: "enable_thinking:false", label: 'enable_thinking = false（extra_body={"enable_thinking":false}）', config: { param: "enable_thinking", value: false }, enablesThinking: false },
  { key: "thinking.type:enabled", label: 'thinking.type = enabled（extra_body={"thinking":{"type":"enabled"}}）', config: { param: "thinking", value: { type: "enabled" } }, enablesThinking: true },
  { key: "thinking.type:disabled", label: 'thinking.type = disabled（extra_body={"thinking":{"type":"disabled"}}）', config: { param: "thinking", value: { type: "disabled" } }, enablesThinking: false },
];

function getThinkingDisableKey(cfg) {
  if (!cfg || !cfg.param) return "";
  if (cfg.param === "enable_thinking") return `enable_thinking:${cfg.value}`;
  if (cfg.param === "thinking" && cfg.value?.type) return `thinking.type:${cfg.value.type}`;
  return "";
}

function resolveSupportsThinking(key, providerDefault) {
  const opt = THINKING_DISABLE_OPTIONS.find((o) => o.key === key);
  if (!opt || opt.enablesThinking === null) return providerDefault;
  return opt.enablesThinking;
}

export default function ModelSettingsPanel({
  open,
  models,
  providerDefinitions,
  isSaving,
  isAdmin,
  onClose,
  onCreateModel,
  onUpdateModel,
  onDeleteModel,
}) {
  const [mode, setMode] = useState("edit");
  const [selectedAlias, setSelectedAlias] = useState("");
  const [draft, setDraft] = useState(() => buildEmptyDraft(providerDefinitions));
  const [clearStoredApiKey, setClearStoredApiKey] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (mode === "create") {
      setDraft(buildEmptyDraft(providerDefinitions));
      setClearStoredApiKey(false);
      return;
    }

    const nextSelectedAlias =
      models.find((model) => model.alias === selectedAlias)?.alias || models[0]?.alias || "";
    setSelectedAlias(nextSelectedAlias);

    const selectedModel = models.find((model) => model.alias === nextSelectedAlias);

    if (selectedModel) {
      const draft = mapModelToDraft(selectedModel);
      const pd = providerDefinitions.find((d) => d.key === selectedModel.providerType);
      draft.supportsThinking = resolveSupportsThinking(
        draft.thinkingDisableKey,
        pd?.supportsThinking !== false,
      );
      setDraft(draft);
      setClearStoredApiKey(false);
    }
  }, [open, mode, models, providerDefinitions, selectedAlias]);

  if (!open) {
    return null;
  }

  const selectedModel = models.find((model) => model.alias === selectedAlias) || null;
  const activeProviderDefinition =
    providerDefinitions.find((definition) => definition.key === draft.providerType) ||
    providerDefinitions[0] ||
    null;

  const handleDraftChange = (patch) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      ...patch,
    }));
  };

  const handleProviderTypeChange = (providerType) => {
    const providerDefinition =
      providerDefinitions.find((definition) => definition.key === providerType) || null;

    handleDraftChange({
      providerType,
      baseURL: providerDefinition?.defaultBaseURL || "",
      apiKeyEnvName: providerDefinition?.defaultEnvKeyName || "OPENAI_API_KEY",
      systemPromptRole: providerDefinition?.defaultSystemPromptRole || "system",
      supportsSystemRole: providerDefinition?.supportsSystemRole !== false,
      supportsMultimodal: providerDefinition?.supportsMultimodal !== false,
      thinkingDisableKey: getThinkingDisableKey(providerDefinition?.thinkingDisableConfig ?? null),
      supportsThinking: resolveSupportsThinking(
        getThinkingDisableKey(providerDefinition?.thinkingDisableConfig ?? null),
        providerDefinition?.supportsThinking !== false,
      ),
      requestOptions: {
        reasoningEffort: providerDefinition?.defaultRequestOptions?.reasoningEffort || "",
        thinkingBudgetTokens: providerDefinition?.defaultRequestOptions?.thinkingBudgetTokens ?? 1024,
        thinkingBudget: providerDefinition?.defaultRequestOptions?.thinkingBudget ?? 0,
        thinkingLevel: providerDefinition?.defaultRequestOptions?.thinkingLevel || "",
        enableThinking: providerDefinition?.defaultRequestOptions?.enableThinking ?? false,
        clearThinking: providerDefinition?.defaultRequestOptions?.clearThinking ?? false,
      },
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const payload = {
      alias: draft.alias.trim(),
      label: draft.label.trim(),
      providerType: draft.providerType,
      baseURL: draft.baseURL.trim(),
      apiKeySource: draft.apiKeySource,
      apiKeyEnvName: draft.apiKeyEnvName.trim(),
      apiKey: draft.apiKey.trim(),
      apiKeyEncrypted: clearStoredApiKey ? "" : undefined,
      modelName: draft.modelName.trim(),
      enabled: draft.enabled,
      supportsStreaming: draft.supportsStreaming,
      supportsSystemRole: draft.supportsSystemRole,
      supportsMultimodal: draft.supportsMultimodal,
      supportsThinking: draft.supportsThinking,
      systemPromptRole: draft.systemPromptRole,
      requestOptions: {
        reasoningEffort: draft.requestOptions?.reasoningEffort || undefined,
        thinkingBudgetTokens: Number(draft.requestOptions?.thinkingBudgetTokens) || 1024,
        thinkingBudget: Number(draft.requestOptions?.thinkingBudget) || 0,
        thinkingLevel: draft.requestOptions?.thinkingLevel || undefined,
        enableThinking: draft.requestOptions?.enableThinking ?? false,
        clearThinking: draft.requestOptions?.clearThinking ?? false,
      },
      thinkingDisable: draft.thinkingDisableKey
        ? THINKING_DISABLE_OPTIONS.find((o) => o.key === draft.thinkingDisableKey)?.config ?? null
        : null,
      shared: draft.shared,
    };

    if (mode === "create") {
      await onCreateModel?.(payload);
      setMode("edit");
      setSelectedAlias(payload.alias);
      return;
    }

    await onUpdateModel?.(selectedAlias, payload);
  };

  const handleDelete = async () => {
    if (!selectedModel || isSaving) {
      return;
    }

    const confirmed = window.confirm(`确认删除模型 ${selectedModel.label} 吗？`);

    if (!confirmed) {
      return;
    }

    await onDeleteModel?.(selectedModel.alias);
    setMode("edit");
    setSelectedAlias("");
  };

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal model-settings-modal">
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <div>
              <div className="settings-eyebrow">Stage 8</div>
              <h2 className="settings-title">模型管理</h2>
            </div>
            <button type="button" className="topbar-btn subtle" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.35rem", verticalAlign: "-0.125rem" }}>
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
              返回
            </button>
          </div>

          <button
            type="button"
            className="settings-primary-btn"
            onClick={() => {
              setMode("create");
              setSelectedAlias("");
              setDraft(buildEmptyDraft(providerDefinitions));
              setClearStoredApiKey(false);
            }}
          >
            新建模型
          </button>

          <div className="settings-model-list">
            {models.map((model) => (
              <button
                key={model.alias}
                type="button"
                className={`settings-model-item ${mode === "edit" && selectedAlias === model.alias ? "active" : ""}`}
                onClick={() => {
                  setMode("edit");
                  setSelectedAlias(model.alias);
                  setDraft(mapModelToDraft(model));
                  setClearStoredApiKey(false);
                }}
              >
                <span className="settings-model-name">{model.label}</span>
                <span className="settings-model-meta">
                  {model.enabled ? "已启用" : "已停用"} · {model.providerType}
                </span>
              </button>
            ))}
          </div>
        </div>

        <form className="settings-form" onSubmit={handleSubmit}>
          <div className="settings-form-header">
            <div>
              <div className="settings-eyebrow">{mode === "create" ? "Create" : "Edit"}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <h3 className="settings-panel-title" style={{ marginBottom: 0 }}>
                  {mode === "create" ? "新增模型" : selectedModel?.label || "模型详情"}
                </h3>
                <div className="reasoning-info-trigger" tabIndex={0} role="button" aria-label="推理参数说明">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                  </svg>
                  <div className="reasoning-info-tooltip">
                    <div className="reasoning-info-tooltip-inner">
                      <h4>推理参数边界处理说明</h4>
                      <ul>
                        <li><strong>选择空值/关闭</strong>：不发送任何推理参数，模型按默认行为输出</li>
                        <li><strong>GLM clear_thinking</strong>：仅在勾选时发送 clear_thinking = true，用于清除推理缓存</li>
                        <li><strong>KIMI Budget 为 0</strong>：视为「自动」模式，不发送 thinking_budget</li>
                        <li><strong>Qwen 关闭开关</strong>：不发送 enable_thinking，模型按默认行为输出</li>
                        <li><strong>切换 Provider</strong>：推理控制参数自动重置为新厂商的默认值</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {mode === "edit" && selectedModel ? (
              <span className={`settings-status-pill ${selectedModel.credentialStatus}`}>
                {getCredentialText(selectedModel)}
              </span>
            ) : null}
          </div>

          <div className="settings-grid">
            <label className="settings-field">
              <span>Alias</span>
              <input
                value={draft.alias}
                onChange={(event) => handleDraftChange({ alias: event.target.value })}
                placeholder="openai:gpt-5-mini"
                disabled={mode === "edit"}
              />
            </label>

            <label className="settings-field">
              <span>显示名</span>
              <input
                value={draft.label}
                onChange={(event) => handleDraftChange({ label: event.target.value })}
                placeholder="我的模型"
              />
            </label>

            <label className="settings-field">
              <span>Provider 类型</span>
              <select
                value={draft.providerType}
                onChange={(event) => handleProviderTypeChange(event.target.value)}
              >
                {providerDefinitions.map((definition) => (
                  <option key={definition.key} value={definition.key}>
                    {definition.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span>模型名</span>
              <input
                value={draft.modelName}
                onChange={(event) => handleDraftChange({ modelName: event.target.value })}
                placeholder="gpt-5-mini-2025-08-07"
              />
            </label>

            <label className="settings-field settings-field-wide">
              <span>Base URL</span>
              <input
                value={draft.baseURL}
                onChange={(event) => handleDraftChange({ baseURL: event.target.value })}
                placeholder="https://api.deepseek.com"
              />
            </label>

            <label className="settings-field">
              <span>System 角色</span>
              <select
                value={draft.systemPromptRole}
                onChange={(event) => handleDraftChange({ systemPromptRole: event.target.value })}
              >
                <option value="system">system</option>
                <option value="developer">developer</option>
              </select>
            </label>

            {draft.supportsThinking && draft.thinkingDisableKey === "" && (activeProviderDefinition?.reasoningControlType === "effort" || activeProviderDefinition?.supportsReasoningEffort) ? (
              <label className="settings-field">
                <span>Reasoning Effort</span>
                <select
                  value={draft.requestOptions?.reasoningEffort || ""}
                  onChange={(event) =>
                    handleDraftChange({
                      requestOptions: {
                        ...draft.requestOptions,
                        reasoningEffort: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">默认（关闭）</option>
                  {(activeProviderDefinition?.reasoningLevels || []).map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {draft.supportsThinking && draft.thinkingDisableKey === "" && activeProviderDefinition?.reasoningControlType === "level" ? (
              <label className="settings-field">
                <span>Thinking Level</span>
                <select
                  value={draft.requestOptions?.thinkingLevel || ""}
                  onChange={(event) =>
                    handleDraftChange({
                      requestOptions: {
                        ...draft.requestOptions,
                        thinkingLevel: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">默认（关闭）</option>
                  {(activeProviderDefinition?.reasoningLevels || []).map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {draft.supportsThinking && draft.thinkingDisableKey === "" && activeProviderDefinition?.reasoningControlType === "budget" ? (
              <label className="settings-field">
                <span>Thinking Budget (tokens)</span>
                <input
                  type="number"
                  min={0}
                  step={128}
                  placeholder="0 = 自动"
                  value={draft.requestOptions?.thinkingBudget ?? 0}
                  onChange={(event) =>
                    handleDraftChange({
                      requestOptions: {
                        ...draft.requestOptions,
                        thinkingBudget: Number(event.target.value) || 0,
                      },
                    })
                  }
                />
              </label>
            ) : null}

            {draft.supportsThinking && draft.thinkingDisableKey === "" && activeProviderDefinition?.reasoningControlType === "switch+budget" ? (
              <>
                <label className="settings-toggle-row settings-field-wide" style={{ marginTop: "0.25rem" }}>
                  <input
                    type="checkbox"
                    checked={draft.requestOptions?.enableThinking ?? false}
                    onChange={(event) =>
                      handleDraftChange({
                        requestOptions: {
                          ...draft.requestOptions,
                          enableThinking: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>启用 Thinking 推理输出</span>
                </label>

                {draft.requestOptions?.enableThinking ? (
                  <label className="settings-field">
                    <span>Thinking Budget (tokens)</span>
                    <input
                      type="number"
                      min={0}
                      step={128}
                      placeholder="0 = 自动"
                      value={draft.requestOptions?.thinkingBudget ?? 0}
                      onChange={(event) =>
                        handleDraftChange({
                          requestOptions: {
                            ...draft.requestOptions,
                            thinkingBudget: Number(event.target.value) || 0,
                          },
                        })
                      }
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {draft.supportsThinking && draft.thinkingDisableKey === "" && activeProviderDefinition?.key === "glm" ? (
              <label className="settings-toggle-row settings-field-wide" style={{ marginTop: "0.25rem" }}>
                <input
                  type="checkbox"
                  checked={draft.requestOptions?.clearThinking ?? false}
                  onChange={(event) =>
                    handleDraftChange({
                      requestOptions: {
                        ...draft.requestOptions,
                        clearThinking: event.target.checked,
                      },
                    })
                  }
                />
                <span>清除 Thinking 缓存（clear_thinking）</span>
              </label>
            ) : null}
          </div>

          <div className="settings-thinking-disable">
            <div className="settings-eyebrow">推理控制（extra_body）</div>
            <label className="settings-field settings-field-wide">
              <span>发送参数</span>
              <select
                value={draft.thinkingDisableKey ?? ""}
                onChange={(event) => {
                  const key = event.target.value;
                  const pd = providerDefinitions.find((d) => d.key === draft.providerType);
                  handleDraftChange({
                    thinkingDisableKey: key,
                    supportsThinking: resolveSupportsThinking(
                      key,
                      pd?.supportsThinking !== false,
                    ),
                  });
                }}
              >
                {THINKING_DISABLE_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-hint" style={{ marginTop: "0.3rem", color: "var(--muted)" }}>
              选择具体参数则由下拉框接管 <code>extra_body</code>，下方详细控件不生效。
              选择「不发送」则走 Provider 原生逻辑，详细控件可用。
            </p>
          </div>

          <div className="settings-provider-hint">
            <div className="settings-eyebrow">Provider 说明</div>
            <p>{activeProviderDefinition?.description || ""}</p>
          </div>

          <div className="settings-credential-card">
            <div className="settings-card-header">
              <h4>凭证来源</h4>
              <div className="settings-toggle-row compact">
                <label>
                  <input
                    type="radio"
                    name="apiKeySource"
                    checked={draft.apiKeySource === "env"}
                    onChange={() => handleDraftChange({ apiKeySource: "env" })}
                  />
                  读取环境变量
                </label>
                <label>
                  <input
                    type="radio"
                    name="apiKeySource"
                    checked={draft.apiKeySource === "stored"}
                    onChange={() => handleDraftChange({ apiKeySource: "stored" })}
                  />
                  保存到本地配置
                </label>
              </div>
            </div>

            {draft.apiKeySource === "env" ? (
              <label className="settings-field settings-field-wide">
                <span>环境变量名</span>
                <input
                  value={draft.apiKeyEnvName}
                  onChange={(event) => handleDraftChange({ apiKeyEnvName: event.target.value })}
                  placeholder="OPENAI_API_KEY"
                />
              </label>
            ) : (
              <div className="settings-grid">
                <label className="settings-field settings-field-wide">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) => {
                      setClearStoredApiKey(false);
                      handleDraftChange({ apiKey: event.target.value });
                    }}
                    placeholder={selectedModel?.hasStoredApiKey ? "留空则保持现有 Key" : "sk-..."}
                  />
                </label>

                {mode === "edit" && selectedModel?.hasStoredApiKey ? (
                  <label className="settings-toggle-row">
                    <input
                      type="checkbox"
                      checked={clearStoredApiKey}
                      onChange={(event) => setClearStoredApiKey(event.target.checked)}
                    />
                    保存时清空已存 Key
                  </label>
                ) : null}
              </div>
            )}
          </div>

          <div className="settings-toggle-grid">
            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => handleDraftChange({ enabled: event.target.checked })}
              />
              启用模型
            </label>

            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draft.supportsStreaming}
                onChange={(event) => handleDraftChange({ supportsStreaming: event.target.checked })}
              />
              标记为支持流式
            </label>

            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draft.supportsSystemRole}
                onChange={(event) => handleDraftChange({ supportsSystemRole: event.target.checked })}
              />
              API 支持 System 角色
            </label>

            <label className="settings-toggle-row">
              <input
                type="checkbox"
                checked={draft.supportsMultimodal}
                onChange={(event) => handleDraftChange({ supportsMultimodal: event.target.checked })}
              />
              API 支持多模态（图片）
            </label>

            {isAdmin ? (
              <label className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={draft.shared}
                  onChange={(event) => handleDraftChange({ shared: event.target.checked })}
                />
                共享给所有用户
              </label>
            ) : null}
          </div>

          <div className="settings-actions">
            {mode === "edit" && selectedModel ? (
              <button
                type="button"
                className="settings-danger-btn"
                onClick={handleDelete}
                disabled={isSaving}
              >
                删除模型
              </button>
            ) : <span />}
            <button type="submit" className="settings-primary-btn" disabled={isSaving}>
              {isSaving ? "保存中..." : mode === "create" ? "创建模型" : "保存修改"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
