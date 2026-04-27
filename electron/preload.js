import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getServerUrl: () => ipcRenderer.invoke("get-server-url"),
  changeServer: () => ipcRenderer.invoke("change-server"),
  retry: () => ipcRenderer.invoke("get-server-url").then((url) => {
    if (url) {
      window.location.href = url;
    }
  }),
});
