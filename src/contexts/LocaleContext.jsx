import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_APP_LOCALE, getPreferredLocale, normalizeSupportedLocale, translate } from "../lib/i18n";

const LocaleContext = createContext(null);
const LOCALE_STORAGE_KEY = "hi-web-talk:locale";

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => getPreferredLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  const setLocale = useCallback((nextLocale) => {
    setLocaleState(normalizeSupportedLocale(nextLocale) || DEFAULT_APP_LOCALE);
  }, []);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}

export default LocaleContext;
