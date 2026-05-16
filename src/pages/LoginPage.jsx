import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import LoginView from "../components/LoginView";

export default function LoginPage() {
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  function handleLogin(user, token) {
    login(user, token);
    const redirectTo = searchParams.get("redirect") || "/";
    navigate(redirectTo, { replace: true });
  }

  return (
    <div className="app-shell login-shell">
      <LoginView onLogin={handleLogin} />
    </div>
  );
}
