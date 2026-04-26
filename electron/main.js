import { app, BrowserWindow, Menu, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;

function resolveServerUrl() {
  if (process.env.HI_WEB_TALK_SERVER) {
    return process.env.HI_WEB_TALK_SERVER;
  }

  return "http://localhost:8787";
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

  if (serverUrl.startsWith("file://")) {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    mainWindow.loadURL(serverUrl);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const template = [
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
            detail: `版本 ${app.getVersion()}`,
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
