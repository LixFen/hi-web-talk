import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";

const rendererUrl = process.env.HI_WEB_TALK_RENDERER_URL || process.env.VITE_DEV_SERVER_URL || "";
const localPort = Number(process.env.OPENAI_PORT || 8787);

let backendServer = null;
let isShuttingDown = false;
let launcherWindow = null;

function getPreloadPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.js");
}

function getLauncherPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "launcher.html");
}

function getUserDataDir() {
  return path.join(app.getPath("userData"), "data");
}

function getRuntimeSecretFilePath() {
  return path.join(app.getPath("userData"), "jwt-secret.txt");
}

function getServerEntryUrl() {
  return new URL("../server/index.js", import.meta.url).href;
}

function getDatabaseUrl() {
  return new URL("../server/lib/database.js", import.meta.url).href;
}

function getPrefPath() {
  const exeDir = path.dirname(app.getPath("exe"));
  return path.join(exeDir, "launcher-preference.json");
}

async function loadPreference() {
  try {
    const data = await fs.readFile(getPrefPath(), "utf8");
    const pref = JSON.parse(data);
    if (pref && pref.mode) return pref;
  } catch { /* not exists or invalid */ }
  return null;
}

async function savePreference(mode, remoteUrl) {
  await fs.writeFile(getPrefPath(), JSON.stringify({ mode, remoteUrl }), "utf8");
}

async function clearPreference() {
  try { await fs.unlink(getPrefPath()); } catch { /* ok */ }
}

async function startLocalBackend() {
  if (backendServer) {
    return backendServer;
  }

  process.env.NODE_ENV = process.env.NODE_ENV || (app.isPackaged ? "production" : "development");
  process.env.HI_WEB_TALK_DATA_DIR = process.env.HI_WEB_TALK_DATA_DIR || getUserDataDir();

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "hi-web-talk-jwt-secret-change-in-production") {
    const runtimeSecretFilePath = getRuntimeSecretFilePath();
    let runtimeSecret = "";

    try {
      runtimeSecret = (await fs.readFile(runtimeSecretFilePath, "utf8")).trim();
    } catch {
      runtimeSecret = crypto.randomBytes(32).toString("hex");
      await fs.mkdir(path.dirname(runtimeSecretFilePath), { recursive: true });
      await fs.writeFile(runtimeSecretFilePath, `${runtimeSecret}\n`, "utf8");
    }

    process.env.JWT_SECRET = runtimeSecret;
  }

  const serverModule = await import(getServerEntryUrl());
  serverModule.validateEnvironment();
  backendServer = await serverModule.startServer(localPort);

  return backendServer;
}

async function stopLocalBackend() {
  if (!backendServer || isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  const server = backendServer;
  backendServer = null;

  await new Promise((resolve) => server.close(resolve));

  try {
    const databaseModule = await import(getDatabaseUrl());
    databaseModule.getDatabase().close();
  } catch {
    // ignore shutdown cleanup errors
  }

  isShuttingDown = false;
}

async function resolveInitialUrl(mode, remoteUrl) {
  if (mode === "remote") {
    return remoteUrl;
  }

  if (rendererUrl) {
    await startLocalBackend();
    return rendererUrl;
  }

  const server = await startLocalBackend();
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : localPort;

  return `http://127.0.0.1:${port}`;
}

function createWindow(initialUrl) {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#111111",
    title: "Hi Web Talk",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Shift+F8 → back to launcher
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "F8" && input.shift && !input.control && !input.alt && !input.meta) {
      goBackToLauncher();
    }
  });

  mainWindow.on("closed", () => {
    // main window tracking handled via getAllWindows checks below
  });

  void mainWindow.loadURL(initialUrl);

  return mainWindow;
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 520,
    height: 440,
    resizable: false,
    backgroundColor: "#111112",
    title: "Hi Web Talk",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void launcherWindow.loadFile(getLauncherPath());
  launcherWindow.on("closed", () => { launcherWindow = null; });

  // send saved preference to pre-fill the form
  launcherWindow.webContents.on("did-finish-load", async () => {
    const pref = await loadPreference();
    if (pref && launcherWindow) {
      launcherWindow.webContents.send("launcher:preference", pref);
    }
  });
}

app.setName("Hi Web Talk");

Menu.setApplicationMenu(null);

ipcMain.handle("shell:openExternal", (_event, url) => shell.openExternal(url));

async function goBackToLauncher() {
  await stopLocalBackend();
  // close all main windows
  BrowserWindow.getAllWindows().forEach((w) => {
    if (w !== launcherWindow) w.close();
  });
  if (!launcherWindow) {
    createLauncherWindow();
  }
}

ipcMain.handle("launcher:submit", async (_event, { mode, remoteUrl }) => {
  try {
    // remember this choice
    await savePreference(mode, remoteUrl);

    const initialUrl = await resolveInitialUrl(mode, remoteUrl);
    // backend ready, now close launcher and open main window
    if (launcherWindow) {
      launcherWindow.close();
    }
    createWindow(initialUrl);
  } catch (error) {
    console.error("Failed to start Hi Web Talk:", error);
    // don't close launcher — send error back so the user sees it
    if (launcherWindow) {
      launcherWindow.webContents.send("launcher:error", error.message);
    } else {
      await shell.beep();
      app.quit();
    }
  }
});

app.whenReady().then(async () => {
  try {
    const envMode = process.env.HI_WEB_TALK_MODE;
    const envRemoteUrl = process.env.HI_WEB_TALK_REMOTE_URL || "http://127.0.0.1:8787";

    if (envMode) {
      // env set → skip launcher (npm scripts / power user)
      const initialUrl = await resolveInitialUrl(envMode, envRemoteUrl);
      createWindow(initialUrl);
      return;
    }

    const pref = await loadPreference();
    if (pref) {
      const initialUrl = await resolveInitialUrl(pref.mode, pref.remoteUrl || "");
      createWindow(initialUrl);
    } else {
      createLauncherWindow();
    }
  } catch (error) {
    console.error("Failed to start Hi Web Talk:", error);
    await shell.beep();
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const envMode = process.env.HI_WEB_TALK_MODE;
    const envRemoteUrl = process.env.HI_WEB_TALK_REMOTE_URL || "http://127.0.0.1:8787";

    if (envMode) {
      const initialUrl = await resolveInitialUrl(envMode, envRemoteUrl);
      createWindow(initialUrl);
      return;
    }

    const pref = await loadPreference();
    if (pref) {
      const initialUrl = await resolveInitialUrl(pref.mode, pref.remoteUrl || "");
      createWindow(initialUrl);
    } else {
      createLauncherWindow();
    }
  }
});

app.on("before-quit", (event) => {
  if (!backendServer || isShuttingDown) {
    return;
  }

  event.preventDefault();
  void (async () => {
    await stopLocalBackend();
    app.exit(0);
  })();
});

app.on("window-all-closed", async () => {
  await stopLocalBackend();

  if (process.platform !== "darwin") {
    app.quit();
  }
});