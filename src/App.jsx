import { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LocaleProvider, useLocale } from "./contexts/LocaleContext";
import { AuthProvider } from "./contexts/AuthContext";
import { AppProvider } from "./contexts/AppContext";
import { SessionProvider } from "./contexts/SessionContext";
import { RequireAuth, RedirectIfAuth } from "./router";
import LoginPage from "./pages/LoginPage";
import AuthenticatedLayout from "./layouts/AuthenticatedLayout";
import ChatHomePage from "./pages/ChatHomePage";
import ChatPage from "./pages/ChatPage";
import "./styles/app.css";

function AppContent() {
  return (
    <AuthProvider>
      <AppProvider>
        <SessionProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <RedirectIfAuth>
                  <LoginPage />
                </RedirectIfAuth>
              }
            />
            <Route
              element={
                <RequireAuth>
                  <AuthenticatedLayout />
                </RequireAuth>
              }
            >
              <Route index element={<ChatHomePage />} />
              <Route
                path="chat/:sessionHash"
                element={<ChatPage />}
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SessionProvider>
      </AppProvider>
    </AuthProvider>
  );
}

function AppShell() {
  const { t } = useLocale();

  return (
    <Suspense
      fallback={
        <div className="empty-state">
          <h2 className="hero-title">{t("app.loading")}</h2>
        </div>
      }
    >
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </Suspense>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}
