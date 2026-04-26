import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let serverConfigPath = null;

function getServerConfigPath() {
  if (!serverConfigPath) {
    serverConfigPath = path.join(app.getPath("userData"), "server-config.json");
  }

  return serverConfigPath;
}

function readStoredServerUrl() {
  try {
    if (fs.existsSync(getServerConfigPath())) {
      const raw = fs.readFileSync(getServerConfigPath(), "utf8");
      const config = JSON.parse(raw);

      if (config.serverUrl) {
        return config.serverUrl;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function writeStoredServerUrl(serverUrl) {
  try {
    fs.mkdirSync(path.dirname(getServerConfigPath()), { recursive: true });
    fs.writeFileSync(getServerConfigPath(), JSON.stringify({ serverUrl }, null, 2), "utf8");
  } catch {
    // ignore
  }
}

function resolveServerUrl() {
  if (process.env.HI_WEB_TALK_SERVER) {
    return process.env.HI_WEB_TALK_SERVER;
  }

  const storedUrl = readStoredServerUrl();

  if (storedUrl) {
    return storedUrl;
  }

  return "http://localhost:8787";
}

function showErrorPage(errorMessage) {
  if (!mainWindow) {
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>连接失败</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0; }
  .box { text-align: center; max-width: 420px; padding: 40px; }
  h2 { color: #e74c3c; margin-bottom: 12px; }
  p { color: #888; margin-bottom: 24px; line-height: 1.6; }
  .url { background: #16213e; padding: 10px 16px; border-radius: 6px; font-family: monospace; color: #4fc3f7; word-break: break-all; margin-bottom: 20px; }
  button { background: #4fc3f7; color: #1a1a2e; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; cursor: pointer; margin: 4px; }
  button.secondary { background: #333; color: #ccc; }
</style></head>
<body>
  <div class="box">
    <h2>无法连接到服务器</h2>
    <p>Hi Web Talk 无法连接到以下地址：</p>
    <div class="url">${escapeHtml(errorMessage)}</div>
    <p>请确认服务器已启动，或重新设置服务器地址。</p>
    <button onclick="window.electronAPI.retry()">重试连接</button>
    <button class="secondary" onclick="window.electronAPI.changeServer()">更改服务器地址</button>
  </div>
</body></html>`;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function promptServerUrl() {
  const currentUrl = resolveServerUrl();
  const result = await dialog.showInputBox(mainWindow, {
    title: "设置服务器地址",
    label: "请输入 Hi Web Talk 服务器地址:",
    value: currentUrl,
    inputAttrs: { type: "url" },
    okLabel: "连接",
    cancelLabel: "取消",
    width: 480,
  });

  if (result) {
    writeStoredServerUrl(result);
    return result;
  }

  return null;
}

function loadApp(serverUrl) {
  if (!mainWindow) {
    return;
  }

  mainWindow.loadURL(serverUrl).catch(() => {
    showErrorPage(serverUrl);
  });

  mainWindow.webContents.on("did-fail-load", (_event, _errorCode, _errorDescription, validatedURL) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showErrorPage(validatedURL);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    title: "Hi Web Talk",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const serverUrl = resolveServerUrl();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  ipcMain.handle("change-server", async () => {
    const newUrl = await promptServerUrl();

    if (newUrl && mainWindow && !mainWindow.isDestroyed()) {
      loadApp(newUrl);
    }

    return newUrl || "";
  });

  ipcMain.handle("get-server-url", () => resolveServerUrl());

  loadApp(serverUrl);
}

const template = [
  {
    label: "文件",
    submenu: [
      {
        label: "设置服务器地址",
        accelerator: "CmdOrCtrl+Shift+S",
        click: async () => {
          const newUrl = await promptServerUrl();

          if (newUrl && mainWindow && !mainWindow.isDestroyed()) {
            loadApp(newUrl);
          }
        },
      },
      { type: "separator" },
      { role: "quit", label: "退出" },
    ],
  },
  {
    label: "编辑",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "视图",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
    ],
  },
  {
    label: "帮助",
    submenu: [
      {
        label: "关于",
        click: () => {
          dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "关于 Hi Web Talk",
            message: "Hi Web Talk",
            detail: `版本 ${app.getVersion()}\n多视图 AI 对话工作台`,
          });
        },
      },
    ],
  },
];

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
