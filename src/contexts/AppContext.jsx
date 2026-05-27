import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createModelConfig,
  deleteModelConfig,
  getAppSettings,
  listAdaptationDefinitions,
  listModelProviderDefinitions,
  listModels,
  updateAppSettings,
  updateModelConfig,
} from "../lib/chatApi";
import { useAuth } from "./AuthContext";
import { useLocale } from "./LocaleContext";
import hljsGithubDark from "highlight.js/styles/github-dark.css?url";

const AppContext = createContext(null);

function pickEnabledModelAlias(models, preferredAlias = "") {
  const enabledModels = models.filter((model) => model.enabled !== false);
  if (enabledModels.length === 0) {
    return "";
  }
  return (
    enabledModels.find((model) => model.alias === preferredAlias)?.alias ||
    enabledModels[0].alias
  );
}

export function AppProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const { t } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  const [modelOptions, setModelOptions] = useState([]);
  const [providerDefinitions, setProviderDefinitions] = useState([]);
  const [adaptationDefinitions, setAdaptationDefinitions] = useState([]);
  const [appSettings, setAppSettings] = useState({});
  const [selectedModelId, setSelectedModelId] = useState(() => {
    try {
      return localStorage.getItem("hi-web-talk:selectedModelId") || "";
    } catch {
      return "";
    }
  });
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [error, setError] = useState("");
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [isAppearanceSaving, setIsAppearanceSaving] = useState(false);
  const [isInteractionSaving, setIsInteractionSaving] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "info" });

  useEffect(() => {
    if (!isAuthenticated) {
      setModelOptions([]);
      setProviderDefinitions([]);
      setAdaptationDefinitions([]);
      setAppSettings({});
      setIsBootstrapping(false);
      return;
    }

    let isCancelled = false;

    async function bootstrap() {
      setIsBootstrapping(true);
      setError("");

      try {
        const [
          { models },
          { definitions },
          { definitions: providerDefs },
          { settings },
        ] = await Promise.all([
          listModels(),
          listAdaptationDefinitions(),
          listModelProviderDefinitions(),
          getAppSettings(),
        ]);

        if (isCancelled) return;

        setModelOptions(models);
        setProviderDefinitions(providerDefs);
        setAdaptationDefinitions(definitions);
        setAppSettings(settings ?? {});
        setSelectedModelId((current) => pickEnabledModelAlias(models, current));
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : tRef.current("app.error.initFailed"));
        }
      } finally {
        if (!isCancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    bootstrap();

    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    try {
      localStorage.setItem("hi-web-talk:selectedModelId", selectedModelId);
    } catch {
      // ignore
    }
  }, [selectedModelId]);

  useEffect(() => {
    const darkMode = appSettings.darkMode || "system";
    const html = document.documentElement;
    const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function syncTheme() {
      if (darkMode === "dark") {
        html.setAttribute("data-theme", "dark");
      } else if (darkMode === "light") {
        html.setAttribute("data-theme", "light");
      } else {
        html.removeAttribute("data-theme");
      }

      let link = document.getElementById("hljs-dark-theme");
      const shouldUseDark =
        darkMode === "dark" ||
        (darkMode !== "light" && darkMediaQuery.matches);

      if (shouldUseDark) {
        if (!link) {
          link = document.createElement("link");
          link.id = "hljs-dark-theme";
          link.rel = "stylesheet";
          link.href = hljsGithubDark;
          document.head.appendChild(link);
        } else {
          link.disabled = false;
        }
      } else if (link) {
        link.disabled = true;
      }
    }

    syncTheme();

    try {
      localStorage.setItem("hi-web-talk:darkMode", darkMode);
    } catch {
      // ignore
    }

    if (darkMode === "system") {
      darkMediaQuery.addEventListener("change", syncTheme);
      return () => darkMediaQuery.removeEventListener("change", syncTheme);
    }
  }, [appSettings.darkMode]);

  const enabledModels = useMemo(
    () => modelOptions.filter((m) => m.enabled !== false),
    [modelOptions],
  );

  const selectedModel = useMemo(
    () =>
      enabledModels.find((m) => m.alias === selectedModelId) ||
      enabledModels[0] ||
      null,
    [enabledModels, selectedModelId],
  );

  const applyModels = useCallback(
    (models, preferredAlias = selectedModelId) => {
      setModelOptions(models);
      setSelectedModelId(pickEnabledModelAlias(models, preferredAlias));
    },
    [selectedModelId],
  );

  const handleCreateModel = useCallback(
    async (payload) => {
      setIsModelSaving(true);
      setError("");
      try {
        const result = await createModelConfig(payload);
        applyModels(result.models, result.model?.alias || payload.alias);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : tRef.current("app.error.createModelFailed"),
        );
        throw err;
      } finally {
        setIsModelSaving(false);
      }
    },
    [applyModels],
  );

  const handleUpdateModel = useCallback(
    async (alias, payload) => {
      setIsModelSaving(true);
      setError("");
      try {
        const result = await updateModelConfig(alias, payload);
        applyModels(result.models, result.model?.alias || alias);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : tRef.current("app.error.updateModelFailed"),
        );
        throw err;
      } finally {
        setIsModelSaving(false);
      }
    },
    [applyModels],
  );

  const handleDeleteModel = useCallback(
    async (alias) => {
      setIsModelSaving(true);
      setError("");
      try {
        const result = await deleteModelConfig(alias);
        applyModels(result.models, selectedModelId === alias ? "" : selectedModelId);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : tRef.current("app.error.deleteModelFailed"),
        );
        throw err;
      } finally {
        setIsModelSaving(false);
      }
    },
    [applyModels, selectedModelId],
  );

  const handleToggleDarkMode = useCallback(async (mode) => {
    setIsAppearanceSaving(true);
    setError("");
    try {
      const result = await updateAppSettings({ darkMode: mode });
      setAppSettings(result?.settings ?? {});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tRef.current("app.error.updateAppearanceFailed"),
      );
    } finally {
      setIsAppearanceSaving(false);
    }
  }, []);

  const handleToggleShowChatFocusOutline = useCallback(async (enabled) => {
    setIsAppearanceSaving(true);
    setError("");
    try {
      const result = await updateAppSettings({ showChatFocusOutline: enabled });
      setAppSettings(result?.settings ?? {});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tRef.current("app.error.updateAppearanceFailed"),
      );
    } finally {
      setIsAppearanceSaving(false);
    }
  }, []);

  const handleToggleHideWideScreenSideBranches = useCallback(async (enabled) => {
    setIsAppearanceSaving(true);
    setError("");
    try {
      const result = await updateAppSettings({ hideWideScreenSideBranches: enabled });
      setAppSettings(result?.settings ?? {});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tRef.current("app.error.updateAppearanceFailed"),
      );
    } finally {
      setIsAppearanceSaving(false);
    }
  }, []);

  const updateInteractionSettings = useCallback(async (partialSettings) => {
    setIsInteractionSaving(true);
    setError("");
    try {
      const result = await updateAppSettings(partialSettings);
      setAppSettings(result?.settings ?? {});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tRef.current("app.error.updateInteractionFailed"),
      );
    } finally {
      setIsInteractionSaving(false);
    }
  }, []);

  const handleToggleShowChatAdaptationButtons = useCallback(
    async (enabled) => {
      await updateInteractionSettings({ showChatAdaptationButtons: enabled });
    },
    [updateInteractionSettings],
  );

  const handleToggleSingleChatAdaptationButton = useCallback(
    async (settingKey, enabled) => {
      if (!settingKey) return;
      await updateInteractionSettings({ [settingKey]: enabled });
    },
    [updateInteractionSettings],
  );

  const handleChangeTitleModel = useCallback(
    async (alias) => {
      await updateInteractionSettings({ titleModelAlias: alias });
    },
    [updateInteractionSettings],
  );

  const handleChangeSummaryModel = useCallback(
    async (alias) => {
      await updateInteractionSettings({ summaryModelAlias: alias });
    },
    [updateInteractionSettings],
  );

  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!toast.message) return undefined;
    if (toast.type === "error") return undefined;
    const timer = setTimeout(() => setToast({ message: "", type: "info" }), 2000);
    return () => clearTimeout(timer);
  }, [toast.message, toast.type]);

  const value = useMemo(
    () => ({
      modelOptions,
      enabledModels,
      providerDefinitions,
      adaptationDefinitions,
      appSettings,
      selectedModelId,
      selectedModel,
      isBootstrapping,
      error,
      toast,
      isModelSaving,
      isAppearanceSaving,
      isInteractionSaving,
      setSelectedModelId,
      setError,
      showToast,
      createModel: handleCreateModel,
      updateModel: handleUpdateModel,
      deleteModel: handleDeleteModel,
      toggleDarkMode: handleToggleDarkMode,
      toggleShowChatFocusOutline: handleToggleShowChatFocusOutline,
      toggleHideWideScreenSideBranches: handleToggleHideWideScreenSideBranches,
      updateInteractionSettings,
      toggleShowChatAdaptationButtons: handleToggleShowChatAdaptationButtons,
      toggleSingleChatAdaptationButton: handleToggleSingleChatAdaptationButton,
      changeTitleModel: handleChangeTitleModel,
      changeSummaryModel: handleChangeSummaryModel,
    }),
    [
      modelOptions,
      enabledModels,
      providerDefinitions,
      adaptationDefinitions,
      appSettings,
      selectedModelId,
      selectedModel,
      isBootstrapping,
      error,
      toast,
      isModelSaving,
      isAppearanceSaving,
      isInteractionSaving,
      handleCreateModel,
      handleUpdateModel,
      handleDeleteModel,
      handleToggleDarkMode,
      handleToggleShowChatFocusOutline,
      handleToggleHideWideScreenSideBranches,
      updateInteractionSettings,
      handleToggleShowChatAdaptationButtons,
      handleToggleSingleChatAdaptationButton,
      handleChangeTitleModel,
      handleChangeSummaryModel,
      showToast,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}

export default AppContext;
