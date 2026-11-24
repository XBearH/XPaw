import "dotenv/config";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Agent } from "../agent.js";
import { compileSystemPrompt, loadCharacterCard } from "../character-card.js";
import { XPawDatabase } from "../database.js";
import { OpenAiCompatibleClient } from "../ollama.js";
import { WorkspaceTools } from "../tools.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspacePath = resolve(process.env.XPAW_WORKSPACE || join(root, "workspace"));
const provider = process.env.XPAW_MODEL_PROVIDER || "ollama";
const baseUrl = process.env.XPAW_MODEL_BASE_URL || "http://127.0.0.1:11434/v1";
let modelId = process.env.XPAW_MODEL_NAME || "qwen2.5:3b";
const apiKey = process.env.XPAW_MODEL_API_KEY;

let database: XPawDatabase;
let agent: Agent;
let conversationId: number;

async function bootstrapRuntime(): Promise<void> {
  await mkdir(workspacePath, { recursive: true });
  const character = await loadCharacterCard(join(root, "characters", "default.yaml"));
  database = new XPawDatabase(join(root, "data", "xpaw.sqlite"));
  conversationId = database.createConversation(character.id, "Desktop session");
  agent = new Agent(
    new OpenAiCompatibleClient(baseUrl, modelId, apiKey),
    database,
    new WorkspaceTools(workspacePath),
    async (question) => {
      const result = await dialog.showMessageBox({
        type: "warning",
        title: "Confirm file write",
        message: "XPaw requests permission to write a file.",
        detail: question,
        buttons: ["Approve", "Deny"],
        defaultId: 1,
        cancelId: 1,
      });
      return result.response === 0;
    },
    compileSystemPrompt(character, workspacePath),
    { provider, modelId },
  );
}

async function listLocalModels(): Promise<string[]> {
  if (provider !== "ollama") return [modelId];
  const response = await fetch(`${baseUrl.replace(/\/v1$/, "")}/api/tags`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Ollama model discovery failed with status ${response.status}.`);
  const data = await response.json() as { models?: Array<{ name?: string }> };
  return data.models?.flatMap((model) => model.name ? [model.name] : []) ?? [];
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#111416",
    title: "XPaw",
    webPreferences: {
      preload: join(dirname(fileURLToPath(import.meta.url)), "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else window.loadFile(join(dirname(fileURLToPath(import.meta.url)), "../renderer/index.html"));
}

app.whenReady().then(async () => {
  await bootstrapRuntime();
  ipcMain.handle("xpaw:send-message", async (_event, message: string) => ({ answer: await agent.respond(conversationId, message) }));
  ipcMain.handle("xpaw:get-config", () => ({ provider, modelId, workspacePath, local: provider === "ollama" }));
  ipcMain.handle("xpaw:get-usage", () => database.getUsageSummary());
  ipcMain.handle("xpaw:list-models", () => listLocalModels());
  ipcMain.handle("xpaw:select-model", async (_event, requestedModelId: string) => {
    if (!requestedModelId || typeof requestedModelId !== "string") throw new Error("A model name is required.");
    const models = await listLocalModels();
    if (!models.includes(requestedModelId)) throw new Error("The selected model is not installed in Ollama.");
    modelId = requestedModelId;
    database.close();
    await bootstrapRuntime();
    return { modelId };
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => database?.close());
