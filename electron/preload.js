import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getServerUrl: () => process.env.HI_WEB_TALK_SERVER || "http://localhost:8787",
});
