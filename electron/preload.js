import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hiWebTalkDesktop", {
  mode: process.env.HI_WEB_TALK_MODE || "local",
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  submitLauncher: (opts) => ipcRenderer.invoke("launcher:submit", opts),
  onLauncherError: (cb) => {
    ipcRenderer.on("launcher:error", (_event, msg) => cb(msg));
  },
  onLauncherPreference: (cb) => {
    ipcRenderer.on("launcher:preference", (_event, pref) => cb(pref));
  },
});