import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("xpaw", {
  startStream: (requestId: string, message: string) => ipcRenderer.invoke("xpaw:start-stream", { requestId, message }),
  cancelStream: (requestId: string) => ipcRenderer.invoke("xpaw:cancel-stream", requestId),
  onStreamEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("xpaw:stream-event", handler);
    return () => ipcRenderer.removeListener("xpaw:stream-event", handler);
  },
  getConfig: () => ipcRenderer.invoke("xpaw:get-config"),
  getUsage: () => ipcRenderer.invoke("xpaw:get-usage"),
  listModels: () => ipcRenderer.invoke("xpaw:list-models"),
  selectModel: (modelId: string) => ipcRenderer.invoke("xpaw:select-model", modelId),
});
