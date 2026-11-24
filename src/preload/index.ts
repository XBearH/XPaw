import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("xpaw", {
  startStream: (requestId: string, message: string) => ipcRenderer.invoke("xpaw:start-stream", { requestId, message }),
  cancelStream: (requestId: string) => ipcRenderer.invoke("xpaw:cancel-stream", requestId),
  newConversation: () => ipcRenderer.invoke("xpaw:new-conversation"),
  listConversations: () => ipcRenderer.invoke("xpaw:list-conversations"),
  selectConversation: (id: number) => ipcRenderer.invoke("xpaw:select-conversation", id),
  renameConversation: (id: number, title: string) => ipcRenderer.invoke("xpaw:rename-conversation", id, title),
  deleteConversation: (id: number) => ipcRenderer.invoke("xpaw:delete-conversation", id),
  onStreamEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on("xpaw:stream-event", handler);
    return () => ipcRenderer.removeListener("xpaw:stream-event", handler);
  },
  getConfig: () => ipcRenderer.invoke("xpaw:get-config"),
  getUsage: (filter?: unknown) => ipcRenderer.invoke("xpaw:get-usage", filter),
  listTasks: () => ipcRenderer.invoke("xpaw:list-tasks"),
  getTaskEvents: (taskId: number) => ipcRenderer.invoke("xpaw:get-task-events", taskId),
  rerunTask: (taskId: number) => ipcRenderer.invoke("xpaw:rerun-task", taskId),
  listModels: () => ipcRenderer.invoke("xpaw:list-models"),
  listProfiles: () => ipcRenderer.invoke("xpaw:list-profiles"),
  saveProfile: (input: unknown) => ipcRenderer.invoke("xpaw:save-profile", input),
  selectProfile: (id: string) => ipcRenderer.invoke("xpaw:select-profile", id),
  testProfile: (input: unknown) => ipcRenderer.invoke("xpaw:test-profile", input),
  getCharacter: () => ipcRenderer.invoke("xpaw:get-character"),
  saveCharacter: (character: unknown) => ipcRenderer.invoke("xpaw:save-character", character),
  selectModel: (modelId: string) => ipcRenderer.invoke("xpaw:select-model", modelId),
});
