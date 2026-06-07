import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { getModelCapabilities } from "../lib/chatApi.js";

// ── Helpers ──

const THINKING_DISABLE_OPTIONS = [
  { key: "", label: "不发送（使用模型默认行为）", config: null, enablesThinking: null },
  { key: "enable_thinking:true", label: 'enable_thinking = true', config: { param: "enable_thinking", value: true }, enablesThinking: true },
  { key: "enable_thinking:false", label: 'enable_thinking = false', config: { param: "enable_thinking", value: false }, enablesThinking: false },
  { key: "thinking.type:enabled", label: 'thinking.type = enabled', config: { param: "thinking", value: { type: "enabled" } }, enablesThinking: true },
  { key: "thinking.type:disabled", label: 'thinking.type = disabled', config: { param: "thinking", value: { type: "disabled" } }, enablesThinking: false },
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

function getCredentialText(item) {
  if (!item) return "";
  if (item.apiKeySource === "stored") {
    return item.hasStoredApiKey ? "已保存本地 Key" : "未保存本地 Key";
  }
  return item.credentialStatus === "configured"
    ? `读取环境变量 ${item.apiKeyEnvName}`
    : `缺少环境变量 ${item.apiKeyEnvName}`;
}

function buildProviderDraft(provider, providerDefinitions) {
  const def = providerDefinitions.find((d) => d.key === provider?.providerType);
  return {
    slug: provider?.slug || "",
    name: provider?.name || "",
    providerType: provider?.providerType || providerDefinitions[0]?.key || "openai-chat-completions",
    baseURL: provider?.baseURL || def?.defaultBaseURL || "",
    apiKeySource: provider?.apiKeySource || "env",
    apiKeyEnvName: provider?.apiKeyEnvName || def?.defaultEnvKeyName || "OPENAI_API_KEY",
    apiKey: "",
    systemPromptRole: provider?.systemPromptRole || def?.defaultSystemPromptRole || "system",
    shared: provider?.shared || false,
  };
}

function buildModelDraft(model, providerDefinitions) {
  const pd = providerDefinitions.find((d) => d.key === model?.providerType);
  const tdKey = getThinkingDisableKey(model?.thinkingDisable ?? null);
  return {
    label: model?.label || "",
    modelName: model?.modelName || "",
    providerId: model?.providerId || "",
    enabled: model?.enabled !== false,
    supportsStreaming: model?.supportsStreaming !== false,
    supportsSystemRole: model?.supportsSystemRole !== false,
    supportsMultimodal: model?.supportsMultimodal !== false,
    thinkingDisableKey: tdKey,
    supportsThinking: resolveSupportsThinking(tdKey, pd?.supportsThinking !== false),
    systemPromptRole: model?.systemPromptRole || "system",
    requestOptions: {
      reasoningEffort: model?.requestOptions?.reasoningEffort || "",
      thinkingBudgetTokens: model?.requestOptions?.thinkingBudgetTokens ?? 1024,
      thinkingBudget: model?.requestOptions?.thinkingBudget ?? 0,
      thinkingLevel: model?.requestOptions?.thinkingLevel || "",
      enableThinking: model?.requestOptions?.enableThinking ?? false,
      clearThinking: model?.requestOptions?.clearThinking ?? false,
    },
    shared: model?.shared || false,
  };
}

function buildEmptyProviderDraft(providerDefinitions) {
  const def = providerDefinitions[0];
  return {
    slug: "",
    name: "",
    providerType: def?.key || "openai-chat-completions",
    baseURL: def?.defaultBaseURL || "",
    apiKeySource: "env",
    apiKeyEnvName: def?.defaultEnvKeyName || "OPENAI_API_KEY",
    apiKey: "",
    systemPromptRole: def?.defaultSystemPromptRole || "system",
    shared: false,
  };
}

function buildEmptyModelDraft(providerId, provider, providerDefinitions) {
  const pd = providerDefinitions.find((d) => d.key === provider?.providerType);
  return {
    label: "",
    modelName: "",
    providerId: providerId || "",
    enabled: true,
    supportsStreaming: true,
    supportsSystemRole: pd?.supportsSystemRole !== false,
    supportsMultimodal: pd?.supportsMultimodal !== false,
    thinkingDisableKey: getThinkingDisableKey(pd?.thinkingDisableConfig ?? null),
    supportsThinking: resolveSupportsThinking(
      getThinkingDisableKey(pd?.thinkingDisableConfig ?? null),
      pd?.supportsThinking !== false,
    ),
    systemPromptRole: pd?.defaultSystemPromptRole || "system",
    requestOptions: {
      reasoningEffort: pd?.defaultRequestOptions?.reasoningEffort || "",
      thinkingBudgetTokens: pd?.defaultRequestOptions?.thinkingBudgetTokens ?? 1024,
      thinkingBudget: pd?.defaultRequestOptions?.thinkingBudget ?? 0,
      thinkingLevel: pd?.defaultRequestOptions?.thinkingLevel || "",
      enableThinking: pd?.defaultRequestOptions?.enableThinking ?? false,
      clearThinking: pd?.defaultRequestOptions?.clearThinking ?? false,
    },
    shared: false,
  };
}

// ── Main Component ──

export default function ModelSettingsPanel({
  open,
  models,
  providers,
  providerDefinitions,
  isSaving,
  isAdmin,
  onClose,
  onCreateModel,
  onUpdateModel,
  onDeleteModel,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
}) {
  // selection: { type: "provider", providerId } | { type: "model", alias } | null
  const [selection, setSelection] = useState(null);
  // formMode: "view" | "create"
  const [formMode, setFormMode] = useState("view");
  // For create: "provider" | "model"
  const [createType, setCreateType] = useState(null);
  // For create model: which provider to add under
  const [createModelProviderId, setCreateModelProviderId] = useState(null);

  const [providerDraft, setProviderDraft] = useState(() => buildEmptyProviderDraft(providerDefinitions));
  const [modelDraft, setModelDraft] = useState(() => buildModelDraft(null, providerDefinitions));
  const [clearStoredApiKey, setClearStoredApiKey] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState(new Set());
  const capabilitiesManuallyChanged = useRef(false);
  const lastInferredModelName = useRef("");

  // Build provider → models mapping
  const providerModelMap = useMemo(() => {
    const map = new Map();
    for (const p of providers) {
      map.set(p.providerId, []);
    }
    // Also include a "no provider" bucket for legacy models
    const legacy = [];
    for (const m of models) {
      if (m.providerId && map.has(m.providerId)) {
        map.get(m.providerId).push(m);
      } else {
        legacy.push(m);
      }
    }
    if (legacy.length > 0) {
      map.set("__legacy__", legacy);
    }
    return map;
  }, [providers, models]);

  // Reset state when panel closes
  useEffect(() => {
    if (!open) {
      setSelection(null);
      setFormMode("view");
      setCreateType(null);
      return;
    }
    // Default: select first provider
    if (!selection && providers.length > 0) {
      setSelection({ type: "provider", providerId: providers[0].providerId });
      setExpandedProviders(new Set([providers[0].providerId]));
    }
  }, [open, providers]);

  // Sync draft when selection changes
  useEffect(() => {
    if (!selection || formMode === "create") return;

    if (selection.type === "provider") {
      const provider = providers.find((p) => p.providerId === selection.providerId);
      if (provider) {
        setProviderDraft(buildProviderDraft(provider, providerDefinitions));
        setClearStoredApiKey(false);
      }
    } else if (selection.type === "model") {
      const model = models.find((m) => m.alias === selection.alias);
      if (model) {
        setModelDraft(buildModelDraft(model, providerDefinitions));
        setClearStoredApiKey(false);
        capabilitiesManuallyChanged.current = false;
        lastInferredModelName.current = "";
      }
    }
  }, [selection, formMode, providers, models, providerDefinitions]);

  // modelName auto-inference (Rules of Hooks: must be before conditional return)
  const handleModelNameBlur = useCallback(async () => {
    const modelName = modelDraft.modelName?.trim();
    if (!modelName || formMode !== "create") return;
    if (modelName === lastInferredModelName.current) return;
    if (capabilitiesManuallyChanged.current) return;

    lastInferredModelName.current = modelName;

    try {
      const result = await getModelCapabilities(modelName);
      if (result?.capabilities) {
        const caps = result.capabilities;
        setModelDraft((prev) => ({
          ...prev,
          supportsMultimodal: caps.supportsMultimodal ?? prev.supportsMultimodal,
          supportsThinking: caps.supportsThinking ?? prev.supportsThinking,
        }));
      }
    } catch {
      // silent
    }
  }, [modelDraft.modelName, formMode]);

  if (!open) return null;

  // ── Derived state ──

  const selectedProvider = selection?.type === "provider"
    ? providers.find((p) => p.providerId === selection.providerId)
    : null;

  const selectedModel = selection?.type === "model"
    ? models.find((m) => m.alias === selection.alias)
    : null;

  const activeProviderDefinition =
    providerDefinitions.find((d) => d.key === (selectedProvider?.providerType || providerDraft.providerType)) ||
    providerDefinitions[0] ||
    null;

  const modelProviderDefinition =
    providerDefinitions.find((d) => d.key === (selectedModel?.providerType || providers.find(p => p.providerId === (modelDraft.providerId || selectedModel?.providerId))?.providerType)) ||
    providerDefinitions[0] ||
    null;

  // ── Handlers ──

  const toggleExpand = (providerId) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const handleSelectProvider = (providerId) => {
    setSelection({ type: "provider", providerId });
    setFormMode("view");
    setCreateType(null);
  };

  const handleSelectModel = (alias) => {
    setSelection({ type: "model", alias });
    setFormMode("view");
    setCreateType(null);
  };

  const handleStartCreateProvider = () => {
    setSelection(null);
    setFormMode("create");
    setCreateType("provider");
    setProviderDraft(buildEmptyProviderDraft(providerDefinitions));
    setClearStoredApiKey(false);
  };

  const handleStartCreateModel = (providerId) => {
    const provider = providers.find((p) => p.providerId === providerId);
    setSelection(null);
    setFormMode("create");
    setCreateType("model");
    setCreateModelProviderId(providerId);
    setModelDraft(buildEmptyModelDraft(providerId, provider, providerDefinitions));
    setClearStoredApiKey(false);
    capabilitiesManuallyChanged.current = false;
    lastInferredModelName.current = "";
    // Auto-expand the provider
    setExpandedProviders((prev) => new Set(prev).add(providerId));
  };

  const handleProviderDraftChange = (patch) => {
    setProviderDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleModelDraftChange = (patch) => {
    setModelDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleCapabilityChange = (patch) => {
    capabilitiesManuallyChanged.current = true;
    handleModelDraftChange(patch);
  };

  const handleProviderTypeChange = (providerType) => {
    const def = providerDefinitions.find((d) => d.key === providerType);
    handleProviderDraftChange({
      providerType,
      baseURL: def?.defaultBaseURL || "",
      apiKeyEnvName: def?.defaultEnvKeyName || "OPENAI_API_KEY",
      systemPromptRole: def?.defaultSystemPromptRole || "system",
    });
  };

  const handleSubmitProvider = async (event) => {
    event.preventDefault();
    const payload = {
      slug: providerDraft.slug.trim(),
      name: providerDraft.name.trim(),
      providerType: providerDraft.providerType,
      baseURL: providerDraft.baseURL.trim(),
      apiKeySource: providerDraft.apiKeySource,
      apiKeyEnvName: providerDraft.apiKeyEnvName.trim(),
      apiKey: providerDraft.apiKey.trim(),
      apiKeyEncrypted: clearStoredApiKey ? "" : undefined,
      systemPromptRole: providerDraft.systemPromptRole,
      shared: providerDraft.shared,
    };

    if (formMode === "create") {
      const provider = await onCreateProvider?.(payload);
      if (provider) {
        setSelection({ type: "provider", providerId: provider.providerId });
        setFormMode("view");
      }
      return;
    }

    await onUpdateProvider?.(selection.providerId, payload);
  };

  const handleSubmitModel = async (event) => {
    event.preventDefault();
    const payload = {
      providerId: modelDraft.providerId,
      modelName: modelDraft.modelName.trim(),
      label: modelDraft.label.trim() || modelDraft.modelName.trim(),
      enabled: modelDraft.enabled,
      supportsStreaming: modelDraft.supportsStreaming,
      supportsSystemRole: modelDraft.supportsSystemRole,
      supportsMultimodal: modelDraft.supportsMultimodal,
      supportsThinking: modelDraft.supportsThinking,
      systemPromptRole: modelDraft.systemPromptRole,
      requestOptions: {
        reasoningEffort: modelDraft.requestOptions?.reasoningEffort || undefined,
        thinkingBudgetTokens: Number(modelDraft.requestOptions?.thinkingBudgetTokens) || 1024,
        thinkingBudget: Number(modelDraft.requestOptions?.thinkingBudget) || 0,
        thinkingLevel: modelDraft.requestOptions?.thinkingLevel || undefined,
        enableThinking: modelDraft.requestOptions?.enableThinking ?? false,
        clearThinking: modelDraft.requestOptions?.clearThinking ?? false,
      },
      thinkingDisable: modelDraft.thinkingDisableKey
        ? THINKING_DISABLE_OPTIONS.find((o) => o.key === modelDraft.thinkingDisableKey)?.config ?? null
        : null,
      shared: modelDraft.shared,
    };

    if (formMode === "create") {
      const model = await onCreateModel?.(payload);
      if (model) {
        setSelection({ type: "model", alias: model.alias });
        setFormMode("view");
      }
      return;
    }

    await onUpdateModel?.(selection.alias, payload);
  };

  const handleDeleteProvider = async () => {
    if (!selectedProvider || isSaving) return;
    const providerModels = providerModelMap.get(selectedProvider.providerId) || [];
    const msg = providerModels.length > 0
      ? `确认删除 Provider "${selectedProvider.name}" 及其下 ${providerModels.length} 个模型吗？`
      : `确认删除 Provider "${selectedProvider.name}" 吗？`;
    if (!window.confirm(msg)) return;
    await onDeleteProvider?.(selectedProvider.providerId);
    setSelection(null);
    setFormMode("view");
  };

  const handleDeleteModel = async () => {
    if (!selectedModel || isSaving) return;
    if (!window.confirm(`确认删除模型 "${selectedModel.label}" 吗？`)) return;
    await onDeleteModel?.(selectedModel.alias);
    // Select the parent provider
    if (selectedModel.providerId) {
      setSelection({ type: "provider", providerId: selectedModel.providerId });
    } else {
      setSelection(null);
    }
    setFormMode("view");
  };

  // ── Render helpers ──

  const renderSidebarItem = (provider) => {
    const providerModels = providerModelMap.get(provider.providerId) || [];
    const isExpanded = expandedProviders.has(provider.providerId);
    const isProviderSelected = selection?.type === "provider" && selection.providerId === provider.providerId;

    return (
      <div key={provider.providerId} className="settings-tree-provider">
        <div
          className={`settings-tree-provider-header ${isProviderSelected ? "active" : ""}`}
          onClick={() => handleSelectProvider(provider.providerId)}
        >
          <button
            type="button"
            className="settings-tree-expand"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(provider.providerId);
            }}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
          <span className="settings-tree-provider-name">{provider.name}</span>
          <button
            type="button"
            className="settings-tree-add-btn"
            title="添加模型"
            onClick={(e) => {
              e.stopPropagation();
              handleStartCreateModel(provider.providerId);
            }}
          >
            +
          </button>
        </div>
        {isExpanded && (
          <div className="settings-tree-models">
            {providerModels.map((model) => (
              <button
                key={model.alias}
                type="button"
                className={`settings-tree-model ${selection?.type === "model" && selection.alias === model.alias ? "active" : ""}`}
                onClick={() => handleSelectModel(model.alias)}
              >
                <span className="settings-tree-model-name">{model.label}</span>
                <span className="settings-tree-model-meta">
                  {model.enabled ? "" : "⏸ "}
                  {model.modelName}
                </span>
              </button>
            ))}
            {providerModels.length === 0 && (
              <div className="settings-tree-empty">暂无模型</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLegacyModels = () => {
    const legacyModels = providerModelMap.get("__legacy__") || [];
    if (legacyModels.length === 0) return null;
    return (
      <div className="settings-tree-provider">
        <div className="settings-tree-provider-header" style={{ opacity: 0.6 }}>
          <span className="settings-tree-expand">▶</span>
          <span className="settings-tree-provider-name">未分组</span>
        </div>
      </div>
    );
  };

  // ── Provider Form ──
  const renderProviderForm = () => (
    <form className="settings-form" onSubmit={handleSubmitProvider}>
      <div className="settings-form-header">
        <div>
          <div className="settings-eyebrow">{formMode === "create" ? "Create Provider" : "Provider"}</div>
          <h3 className="settings-panel-title">
            {formMode === "create" ? "新建 Provider" : selectedProvider?.name || "Provider 详情"}
          </h3>
        </div>
        {formMode === "edit" && selectedProvider ? (
          <span className={`settings-status-pill ${selectedProvider.credentialStatus}`}>
            {getCredentialText(selectedProvider)}
          </span>
        ) : null}
      </div>

      <div className="settings-grid">
        {formMode === "create" ? (
          <label className="settings-field">
            <span>Slug（唯一标识）</span>
            <input
              value={providerDraft.slug}
              onChange={(e) => handleProviderDraftChange({ slug: e.target.value })}
              placeholder="deepseek"
              pattern="[a-z0-9_-]+"
              required
            />
          </label>
        ) : null}

        <label className="settings-field">
          <span>显示名</span>
          <input
            value={providerDraft.name}
            onChange={(e) => handleProviderDraftChange({ name: e.target.value })}
            placeholder="DeepSeek"
          />
        </label>

        <label className="settings-field">
          <span>Provider 类型</span>
          <select
            value={providerDraft.providerType}
            onChange={(e) => handleProviderTypeChange(e.target.value)}
            disabled={formMode === "edit"}
          >
            {providerDefinitions.map((def) => (
              <option key={def.key} value={def.key}>{def.label}</option>
            ))}
          </select>
        </label>

        <label className="settings-field settings-field-wide">
          <span>Base URL</span>
          <input
            value={providerDraft.baseURL}
            onChange={(e) => handleProviderDraftChange({ baseURL: e.target.value })}
            placeholder="https://api.deepseek.com"
          />
        </label>

        <label className="settings-field">
          <span>System 角色</span>
          <select
            value={providerDraft.systemPromptRole}
            onChange={(e) => handleProviderDraftChange({ systemPromptRole: e.target.value })}
          >
            <option value="system">system</option>
            <option value="developer">developer</option>
          </select>
        </label>
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
              <input type="radio" name="apiKeySource" checked={providerDraft.apiKeySource === "env"} onChange={() => handleProviderDraftChange({ apiKeySource: "env" })} />
              读取环境变量
            </label>
            <label>
              <input type="radio" name="apiKeySource" checked={providerDraft.apiKeySource === "stored"} onChange={() => handleProviderDraftChange({ apiKeySource: "stored" })} />
              保存到本地配置
            </label>
          </div>
        </div>

        {providerDraft.apiKeySource === "env" ? (
          <label className="settings-field settings-field-wide">
            <span>环境变量名</span>
            <input value={providerDraft.apiKeyEnvName} onChange={(e) => handleProviderDraftChange({ apiKeyEnvName: e.target.value })} placeholder="OPENAI_API_KEY" />
          </label>
        ) : (
          <div className="settings-grid">
            <label className="settings-field settings-field-wide">
              <span>API Key</span>
              <input
                type="password"
                value={providerDraft.apiKey}
                onChange={(e) => { setClearStoredApiKey(false); handleProviderDraftChange({ apiKey: e.target.value }); }}
                placeholder={formMode === "edit" && selectedProvider?.hasStoredApiKey ? "留空则保持现有 Key" : "sk-..."}
              />
            </label>
            {formMode === "edit" && selectedProvider?.hasStoredApiKey ? (
              <label className="settings-toggle-row">
                <input type="checkbox" checked={clearStoredApiKey} onChange={(e) => setClearStoredApiKey(e.target.checked)} />
                保存时清空已存 Key
              </label>
            ) : null}
          </div>
        )}
      </div>

      {isAdmin ? (
        <div className="settings-toggle-grid">
          <label className="settings-toggle-row">
            <input type="checkbox" checked={providerDraft.shared} onChange={(e) => handleProviderDraftChange({ shared: e.target.checked })} />
            共享给所有用户
          </label>
        </div>
      ) : null}

      <div className="settings-actions">
        {formMode !== "create" && selectedProvider ? (
          <button type="button" className="settings-danger-btn" onClick={handleDeleteProvider} disabled={isSaving}>
            删除 Provider
          </button>
        ) : <span />}
        <button type="submit" className="settings-primary-btn" disabled={isSaving}>
          {isSaving ? "保存中..." : formMode === "create" ? "创建 Provider" : "保存修改"}
        </button>
      </div>
    </form>
  );

  // ── Model Form ──
  const renderModelForm = () => {
    const providerOfModel = providers.find((p) => p.providerId === modelDraft.providerId);
    const pd = providerDefinitions.find((d) => d.key === providerOfModel?.providerType);

    return (
      <form className="settings-form" onSubmit={handleSubmitModel}>
        <div className="settings-form-header">
          <div>
            <div className="settings-eyebrow">{formMode === "create" ? "Create Model" : "Model"}</div>
            <h3 className="settings-panel-title">
              {formMode === "create" ? `在 ${providerOfModel?.name || "?"} 下新建模型` : selectedModel?.label || "模型详情"}
            </h3>
            {providerOfModel && (
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                Provider: {providerOfModel.name} ({providerOfModel.providerType})
              </div>
            )}
          </div>
          {formMode === "edit" && selectedModel ? (
            <span className={`settings-status-pill ${selectedModel.credentialStatus}`}>
              {getCredentialText(selectedModel)}
            </span>
          ) : null}
        </div>

        <div className="settings-grid">
          <label className="settings-field">
            <span>模型名</span>
            <input
              value={modelDraft.modelName}
              onChange={(e) => {
                handleModelDraftChange({ modelName: e.target.value });
                capabilitiesManuallyChanged.current = false;
                lastInferredModelName.current = "";
              }}
              onBlur={handleModelNameBlur}
              placeholder="deepseek-chat"
              disabled={formMode === "edit"}
            />
            {formMode === "create" && lastInferredModelName.current === modelDraft.modelName?.trim() && lastInferredModelName.current ? (
              <span style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.1rem" }}>
                ✨ 已根据模型名自动推断能力
              </span>
            ) : null}
          </label>

          <label className="settings-field">
            <span>显示名</span>
            <input
              value={modelDraft.label}
              onChange={(e) => handleModelDraftChange({ label: e.target.value })}
              placeholder="DeepSeek Chat"
            />
          </label>

          {formMode === "edit" && selectedModel ? (
            <label className="settings-field">
              <span>Alias</span>
              <input value={selectedModel.alias} disabled />
            </label>
          ) : null}
        </div>

        <div className="settings-grid">
          <label className="settings-field">
            <span>System 角色</span>
            <select value={modelDraft.systemPromptRole} onChange={(e) => handleModelDraftChange({ systemPromptRole: e.target.value })}>
              <option value="system">system</option>
              <option value="developer">developer</option>
            </select>
          </label>
        </div>

        {/* Reasoning controls */}
        {modelDraft.supportsThinking && modelDraft.thinkingDisableKey === "" && (pd?.reasoningControlType === "effort" || pd?.supportsReasoningEffort) ? (
          <label className="settings-field">
            <span>Reasoning Effort</span>
            <select value={modelDraft.requestOptions?.reasoningEffort || ""} onChange={(e) => handleModelDraftChange({ requestOptions: { ...modelDraft.requestOptions, reasoningEffort: e.target.value } })}>
              <option value="">默认（关闭）</option>
              {(pd?.reasoningLevels || []).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        ) : null}

        {modelDraft.supportsThinking && modelDraft.thinkingDisableKey === "" && pd?.reasoningControlType === "level" ? (
          <label className="settings-field">
            <span>Thinking Level</span>
            <select value={modelDraft.requestOptions?.thinkingLevel || ""} onChange={(e) => handleModelDraftChange({ requestOptions: { ...modelDraft.requestOptions, thinkingLevel: e.target.value } })}>
              <option value="">默认（关闭）</option>
              {(pd?.reasoningLevels || []).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        ) : null}

        {modelDraft.supportsThinking && modelDraft.thinkingDisableKey === "" && pd?.reasoningControlType === "budget" ? (
          <label className="settings-field">
            <span>Thinking Budget (tokens)</span>
            <input type="number" min={0} step={128} placeholder="0 = 自动" value={modelDraft.requestOptions?.thinkingBudget ?? 0} onChange={(e) => handleModelDraftChange({ requestOptions: { ...modelDraft.requestOptions, thinkingBudget: Number(e.target.value) || 0 } })} />
          </label>
        ) : null}

        {modelDraft.supportsThinking && modelDraft.thinkingDisableKey === "" && pd?.reasoningControlType === "switch+budget" ? (
          <>
            <label className="settings-toggle-row settings-field-wide" style={{ marginTop: "0.25rem" }}>
              <input type="checkbox" checked={modelDraft.requestOptions?.enableThinking ?? false} onChange={(e) => handleModelDraftChange({ requestOptions: { ...modelDraft.requestOptions, enableThinking: e.target.checked } })} />
              <span>启用 Thinking 推理输出</span>
            </label>
            {modelDraft.requestOptions?.enableThinking ? (
              <label className="settings-field">
                <span>Thinking Budget (tokens)</span>
                <input type="number" min={0} step={128} placeholder="0 = 自动" value={modelDraft.requestOptions?.thinkingBudget ?? 0} onChange={(e) => handleModelDraftChange({ requestOptions: { ...modelDraft.requestOptions, thinkingBudget: Number(e.target.value) || 0 } })} />
              </label>
            ) : null}
          </>
        ) : null}

        {modelDraft.supportsThinking && modelDraft.thinkingDisableKey === "" && pd?.key === "glm" ? (
          <label className="settings-toggle-row settings-field-wide" style={{ marginTop: "0.25rem" }}>
            <input type="checkbox" checked={modelDraft.requestOptions?.clearThinking ?? false} onChange={(e) => handleModelDraftChange({ requestOptions: { ...modelDraft.requestOptions, clearThinking: e.target.checked } })} />
            <span>清除 Thinking 缓存（clear_thinking）</span>
          </label>
        ) : null}

        <div className="settings-thinking-disable">
          <div className="settings-eyebrow">推理控制（extra_body）</div>
          <label className="settings-field settings-field-wide">
            <span>发送参数</span>
            <select value={modelDraft.thinkingDisableKey ?? ""} onChange={(e) => {
              const key = e.target.value;
              handleModelDraftChange({
                thinkingDisableKey: key,
                supportsThinking: resolveSupportsThinking(key, pd?.supportsThinking !== false),
              });
            }}>
              {THINKING_DISABLE_OPTIONS.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
            </select>
          </label>
        </div>

        <div className="settings-toggle-grid">
          <label className="settings-toggle-row">
            <input type="checkbox" checked={modelDraft.enabled} onChange={(e) => handleModelDraftChange({ enabled: e.target.checked })} />
            启用模型
          </label>
          <label className="settings-toggle-row">
            <input type="checkbox" checked={modelDraft.supportsStreaming} onChange={(e) => handleModelDraftChange({ supportsStreaming: e.target.checked })} />
            标记为支持流式
          </label>
          <label className="settings-toggle-row">
            <input type="checkbox" checked={modelDraft.supportsSystemRole} onChange={(e) => handleModelDraftChange({ supportsSystemRole: e.target.checked })} />
            API 支持 System 角色
          </label>
          <label className="settings-toggle-row">
            <input type="checkbox" checked={modelDraft.supportsMultimodal} onChange={(e) => handleCapabilityChange({ supportsMultimodal: e.target.checked })} />
            API 支持多模态（图片）
          </label>
          {isAdmin ? (
            <label className="settings-toggle-row">
              <input type="checkbox" checked={modelDraft.shared} onChange={(e) => handleModelDraftChange({ shared: e.target.checked })} />
              共享给所有用户
            </label>
          ) : null}
        </div>

        <div className="settings-actions">
          {formMode !== "create" && selectedModel ? (
            <button type="button" className="settings-danger-btn" onClick={handleDeleteModel} disabled={isSaving}>
              删除模型
            </button>
          ) : <span />}
          <button type="submit" className="settings-primary-btn" disabled={isSaving}>
            {isSaving ? "保存中..." : formMode === "create" ? "创建模型" : "保存修改"}
          </button>
        </div>
      </form>
    );
  };

  // ── Main render ──
  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal model-settings-modal">
        {/* Sidebar */}
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

          <button type="button" className="settings-primary-btn" onClick={handleStartCreateProvider}>
            新建 Provider
          </button>

          <div className="settings-model-list">
            {providers.map(renderSidebarItem)}
            {renderLegacyModels()}
          </div>
        </div>

        {/* Form area */}
        {formMode === "create" && createType === "provider" && renderProviderForm()}
        {formMode === "create" && createType === "model" && renderModelForm()}
        {formMode === "view" && selection?.type === "provider" && renderProviderForm()}
        {formMode === "view" && selection?.type === "model" && renderModelForm()}
        {formMode === "view" && !selection && (
          <div className="settings-form" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
            <p>选择一个 Provider 或模型开始编辑</p>
          </div>
        )}
      </div>
    </div>
  );
}
