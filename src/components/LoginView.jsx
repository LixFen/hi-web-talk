import { useState } from "react";

export default function LoginView({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.text();
      let result = null;

      if (data) {
        try { result = JSON.parse(data); } catch { /* ignore */ }
      }

      if (!response.ok) {
        setError(result?.error || "操作失败，请稍后再试。");
        return;
      }

      onLogin(result.user, result.token);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "网络错误，请检查服务端是否已启动。",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="empty-state">
      <div className="hero-logo-container">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" fill="var(--text-primary)"/>
          <path d="M14.5 12L10 9V15L14.5 12Z" fill="var(--bg-main)"/>
        </svg>
      </div>
      <h2 className="hero-title">{isRegister ? "创建账号" : "欢迎回来"}</h2>

      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-field">
          <input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
            disabled={isSubmitting}
          />
        </div>
        <div className="login-field">
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
          />
        </div>

        {error && <div className="login-error">{error}</div>}

        <button
          type="submit"
          className="suggestion-card login-submit-btn"
          disabled={isSubmitting || !username.trim() || !password.trim()}
        >
          {isSubmitting ? "请稍候..." : isRegister ? "注册" : "登录"}
        </button>
      </form>

      <p className="login-switch">
        {isRegister ? "已有账号？" : "没有账号？"}
        <button
          type="button"
          className="login-switch-btn"
          onClick={() => { setError(""); setIsRegister(!isRegister); }}
          disabled={isSubmitting}
        >
          {isRegister ? "去登录" : "去注册"}
        </button>
      </p>
    </div>
  );
}
