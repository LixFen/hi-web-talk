import { useLocale } from "../contexts/LocaleContext";

export default function LoadingFallback({ text }) {
  const { t } = useLocale();

  return (
    <div className="loading-fallback">
      <div className="loading-fallback-spinner" />
      <div className="loading-fallback-text">
        {text || t("app.loading")}
      </div>
    </div>
  );
}
