import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";

export function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    const currentPath = window.location.pathname + window.location.search;
    return (
      <Navigate
        to={`/login${currentPath !== "/login" && currentPath !== "/" ? `?redirect=${encodeURIComponent(currentPath)}` : ""}`}
        replace
      />
    );
  }

  return children;
}

export function RedirectIfAuth({ children }) {
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
