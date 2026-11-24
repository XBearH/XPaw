import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("xpaw", {
  sendMessage: (message: string) => ipcRenderer.invoke("xpaw:send-message", message),
  getConfig: () => ipcRenderer.invoke("xpaw:get-config"),
  getUsage: () => ipcRenderer.invoke("xpaw:get-usage"),
  listModels: () => ipcRenderer.invoke("xpaw:list-models"),
  selectModel: (modelId: string) => ipcRenderer.invoke("xpaw:select-model", modelId),
});
