import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  getStoredUser,
  getToken,
  setStoredUser,
  setToken,
  clearStoredUser,
  clearToken,
} from "../lib/tokenStore";
import { logoutUser } from "../lib/chatApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    Boolean(getToken() && getStoredUser()),
  );

  const handleLogin = useCallback((user, token) => {
    setToken(token);
    setStoredUser(user);
    setCurrentUser(user);
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(() => {
    logoutUser().catch(() => {});
    clearToken();
    clearStoredUser();
    setCurrentUser(null);
    setIsAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({
      currentUser,
      isAuthenticated,
      isAdmin: currentUser?.role === "admin",
      login: handleLogin,
      logout: handleLogout,
    }),
    [currentUser, isAuthenticated, handleLogin, handleLogout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export default AuthContext;
