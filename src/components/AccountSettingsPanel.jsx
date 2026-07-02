import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLocale } from "../contexts/LocaleContext";
import { changePassword } from "../lib/chatApi";

export default function AccountSettingsPanel({ open, onClose }) {
  const { t } = useLocale();
  const { currentUser } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) {
    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword.length < 4) {
      setError(t("account.error.weakPassword"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("account.error.passwordMismatch"));
      return;
    }

    setIsSubmitting(true);

    try {
      await changePassword(oldPassword, newPassword);
      setSuccess(true);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("login.error.operationFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isFormValid = oldPassword.trim() && newPassword.trim() && confirmPassword.trim();

  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label={t("account.title")}>
      <div className="settings-modal about-settings-modal">
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <div>
              <div className="settings-eyebrow">{t("settings.title")}</div>
              <h2 className="settings-title">{t("account.title")}</h2>
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
            {t("account.summary")}
          </p>

          <div className="settings-about-version-badge">
            <span>{t("login.username")}</span>
            <strong>{currentUser?.username ?? ""}</strong>
          </div>
        </div>

        <div className="settings-form">
          <div className="settings-form-header">
            <div>
              <div className="settings-eyebrow">{t("settings.title")}</div>
              <h3 className="settings-panel-title">{t("account.title")}</h3>
            </div>
          </div>

          <section className="settings-appearance-card" aria-label={t("account.title")}>
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="login-field">
                <input
                  type="password"
                  placeholder={t("account.currentPassword")}
                  value={oldPassword}
                  onChange={(e) => { setOldPassword(e.target.value); setSuccess(false); }}
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
              <div className="login-field">
                <input
                  type="password"
                  placeholder={t("account.newPassword")}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setSuccess(false); }}
                  disabled={isSubmitting}
                />
              </div>
              <div className="login-field">
                <input
                  type="password"
                  placeholder={t("account.confirmPassword")}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setSuccess(false); }}
                  disabled={isSubmitting}
                />
              </div>

              {error && <div className="login-error">{error}</div>}
              {success && <div className="login-success">{t("account.success")}</div>}

              <button
                type="submit"
                className="suggestion-card login-submit-btn"
                disabled={isSubmitting || !isFormValid}
              >
                {isSubmitting ? t("login.submitting") : t("account.submit")}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
