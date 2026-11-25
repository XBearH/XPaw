import "dotenv/config";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve } from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Agent } from "../agent.js";
import { compileSystemPrompt, loadCharacterCard, type CharacterCard } from "../character-card.js";
import { XPawDatabase } from "../database.js";
import { OpenAiCompatibleClient } from "../ollama.js";
import { WorkspaceTools } from "../tools.js";
import type { McpServerProfile, McpToolInfo, MemoryItem, ModelProfile, UserProfile } from "../types.js";
import { SecretVault } from "./secret-vault.js";
import { McpClientManager } from "./mcp-client.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspacePath = resolve(process.env.XPAW_WORKSPACE || join(root, "workspace"));
app.setPath("userData", join(root, "data", "electron"));
const provider = process.env.XPAW_MODEL_PROVIDER || "ollama";
const baseUrl = process.env.XPAW_MODEL_BASE_URL || "http://127.0.0.1:11434/v1";
let modelId = process.env.XPAW_MODEL_NAME || "qwen2.5:3b";
const apiKey = process.env.XPAW_MODEL_API_KEY;

let database: XPawDatabase;
let agent: Agent;
let conversationId: number;
let activeProfile: ModelProfile;
let character: CharacterCard;
const vault = new SecretVault(join(root, "data", "secrets.json"));
const activeRequests = new Map<string, AbortController>();
const mcp = new McpClientManager();

function startTaskStream(sender: { send(channel: string, ...args: unknown[]): void }, input: { requestId: string; message: string }, saveUser = true): void {
  if (activeRequests.has(input.requestId)) throw new Error("This request is already active.");
  const controller = new AbortController();
  activeRequests.set(input.requestId, controller);
  const taskId = database.createTask(conversationId, input.message);
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 5 * 60_000);
  void (async () => {
    try {
      sender.send("xpaw:stream-event", { requestId: input.requestId, type: "task", taskId });
      const requestAgent = createAgentForRequest(input.message);
      for await (const streamEvent of requestAgent.streamRespond(conversationId, input.message, controller.signal, taskId, saveUser)) {
        sender.send("xpaw:stream-event", { requestId: input.requestId, taskId, ...streamEvent });
      }
      await summarizeConversationIfNeeded();
    } finally {
      clearTimeout(timeout);
      if (timedOut) {
        database.updateTask(taskId, "failed", { error: "任务超过 5 分钟总时限。" });
        database.addTaskEvent(taskId, "timeout", "任务超过 5 分钟总时限，已停止。");
      }
      activeRequests.delete(input.requestId);
    }
  })();
}

async function bootstrapRuntime(): Promise<void> {
  await mkdir(workspacePath, { recursive: true });
  character = await loadCharacterCard(join(root, "characters", "default.yaml"));
  database = new XPawDatabase(join(root, "data", "xpaw.sqlite"));
  const profileId = "local-ollama-default";
  const existingProfile = database.listModelProfiles().find((profile) => profile.id === profileId);
  if (!existingProfile) database.upsertModelProfile({ id: profileId, name: "本地 Ollama", provider: "ollama", baseUrl, modelId, temperature: 0.35, maxTokens: 384, toolsEnabled: true, local: true });
  activeProfile = database.listModelProfiles().find((profile) => profile.id === profileId)!;
  applyCharacterOverride();
  conversationId = database.createConversation(character.id, "Desktop session");
  agent = createAgent(character);
}

function applyCharacterOverride(): void {
  const override = database.getCharacterOverride(character.id);
  if (!override) return;
  character = {
    ...character,
    name: override.name,
    description: override.description,
    identity: { ...character.identity, role: override.role, summary: override.summary },
    personality: { ...character.personality, speaking_style: { ...character.personality.speaking_style, tone: override.tone } },
  };
}

function createAgent(character: Awaited<ReturnType<typeof loadCharacterCard>>): Agent {
  const mcpProfiles = database.listMcpServers();
  const externalTools = mcp.getAuthorizedToolDefinitions(mcpProfiles, (serverId, toolName) => database.getMcpToolAuthorization(serverId, toolName));
  return new Agent(
    new OpenAiCompatibleClient(activeProfile.baseUrl, activeProfile, activeProfile.id === "local-ollama-default" ? apiKey : vault.get(activeProfile.id)),
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
    compileSystemPrompt(character, workspacePath, database.getUserProfile()),
    { provider: activeProfile.provider, modelId: activeProfile.modelId },
    externalTools,
    async (name, args) => executeMcpTool(name, args),
  );
}

function createAgentForRequest(userInput: string): Agent {
  const profile = database.getUserProfile();
  const memories = database.searchMemories(userInput);
  const summary = database.getConversationSummary(conversationId)?.content;
  const knowledge = database.searchKnowledge(userInput);
  const mcpProfiles = database.listMcpServers();
  const externalTools = mcp.getAuthorizedToolDefinitions(mcpProfiles, (serverId, toolName) => database.getMcpToolAuthorization(serverId, toolName));
  return new Agent(
    new OpenAiCompatibleClient(activeProfile.baseUrl, activeProfile, activeProfile.id === "local-ollama-default" ? apiKey : vault.get(activeProfile.id)),
    database,
    new WorkspaceTools(workspacePath),
    async (question) => (await dialog.showMessageBox({ type: "warning", title: "Confirm file write", message: "XPaw requests permission to write a file.", detail: question, buttons: ["Approve", "Deny"], defaultId: 1, cancelId: 1 })).response === 0,
    compileSystemPrompt(character, workspacePath, profile, memories, summary, knowledge),
    { provider: activeProfile.provider, modelId: activeProfile.modelId },
    externalTools,
    async (name, args) => executeMcpTool(name, args),
  );
}

async function executeMcpTool(key: string, args: Record<string, unknown>): Promise<{ content: string; summary: string }> {
  const resolved = mcp.resolveTool(key);
  if (!resolved) throw new Error("MCP 工具映射不存在，请重新发现工具。 ");
  const profile = database.listMcpServers().find((server) => server.id === resolved.serverId);
  if (!profile || !profile.enabled) throw new Error("MCP Server 已禁用或不存在。");
  const authorization = database.getMcpToolAuthorization(resolved.serverId, resolved.toolName);
  if (authorization === "deny") throw new Error("该 MCP 工具已被拒绝。");
  if (authorization === "ask") {
    const result = await dialog.showMessageBox({ type: "warning", title: "Confirm MCP tool", message: `XPaw requests permission to call MCP tool: ${resolved.toolName}`, detail: `Server: ${profile.name}\nArguments: ${JSON.stringify(args, null, 2)}`, buttons: ["Approve once", "Deny"], defaultId: 1, cancelId: 1 });
    if (result.response !== 0) throw new Error("用户拒绝了 MCP 工具调用。");
  }
  const content = await mcp.callTool(profile, resolved.toolName, args);
  return { content, summary: `MCP ${profile.name}/${resolved.toolName} 已完成。` };
}

async function summarizeConversationIfNeeded(): Promise<void> {
  const messages = database.getMessages(conversationId, 100);
  const existing = database.getConversationSummary(conversationId);
  if (messages.length < 20 || messages.length <= (existing?.sourceMessageCount ?? 0) + 8) return;
  const transcript = messages.slice(-40).map((message) => `${message.role}: ${message.content}`).join("\n").slice(0, 20_000);
  try {
    const client = new OpenAiCompatibleClient(activeProfile.baseUrl, { ...activeProfile, maxTokens: 384, toolsEnabled: false, temperature: 0.2 }, activeProfile.id === "local-ollama-default" ? apiKey : vault.get(activeProfile.id));
    const result = await client.chat([{ role: "system", content: "Summarize this conversation in concise Chinese. Keep stable facts, decisions, preferences, unresolved tasks, and roleplay context. Do not invent facts." }, { role: "user", content: transcript }], []);
    if (result.content?.trim()) database.saveConversationSummary(conversationId, result.content.trim(), messages.length);
  } catch { /* Optional compression must never block a user task. */ }
}

async function importKnowledgeFile(filePath: string): Promise<void> {
  const allowed = new Set([".txt", ".md", ".json", ".csv", ".yaml", ".yml"]);
  if (!allowed.has(extname(filePath).toLowerCase())) throw new Error("当前只支持 TXT、Markdown、JSON、CSV 和 YAML 文本文件。");
  if ((await stat(filePath)).size > 5 * 1024 * 1024) throw new Error("单个知识库文件不能超过 5 MB。");
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const chunks: Array<{ startLine: number; endLine: number; content: string }> = [];
  for (let start = 0; start < lines.length; start += 80) {
    const end = Math.min(lines.length, start + 80);
    const chunk = lines.slice(start, end).join("\n").trim();
    if (chunk) chunks.push({ startLine: start + 1, endLine: end, content: chunk });
  }
  database.upsertKnowledgeDocument({ path: resolve(filePath), name: basename(filePath), contentHash: createHash("sha256").update(content).digest("hex"), chunks });
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
  database.markRunningTasksInterrupted();
  ipcMain.handle("xpaw:start-stream", async (event, input: { requestId: string; message: string }) => {
    if (!input?.requestId || !input.message?.trim()) throw new Error("A request ID and message are required.");
    startTaskStream(event.sender, input);
    return { started: true };
  });
  ipcMain.handle("xpaw:regenerate", (event, requestId: string) => {
    const userMessage = database.getLatestUserMessage(conversationId);
    if (!userMessage) throw new Error("没有可重新生成的上一条用户消息。");
    database.deleteLatestAssistantMessage(conversationId);
    startTaskStream(event.sender, { requestId, message: userMessage }, false);
    return { started: true, message: userMessage };
  });
  ipcMain.handle("xpaw:cancel-stream", (_event, requestId: string) => activeRequests.get(requestId)?.abort());
  ipcMain.handle("xpaw:new-conversation", async () => {
    const character = await loadCharacterCard(join(root, "characters", "default.yaml"));
    conversationId = database.createConversation(character.id, "Desktop session");
    return { conversationId };
  });
  ipcMain.handle("xpaw:list-conversations", () => database.listConversations());
  ipcMain.handle("xpaw:select-conversation", (_event, id: number) => {
    if (!Number.isInteger(id)) throw new Error("无效会话。 ");
    conversationId = id;
    return { conversationId, messages: database.getMessages(id, 100).filter((message) => message.role !== "tool") };
  });
  ipcMain.handle("xpaw:rename-conversation", (_event, id: number, title: string) => database.renameConversation(id, title.trim().slice(0, 80) || "未命名对话"));
  ipcMain.handle("xpaw:delete-conversation", (_event, id: number) => database.deleteConversation(id));
  ipcMain.handle("xpaw:get-config", () => ({ provider: activeProfile.provider, modelId: activeProfile.modelId, workspacePath, local: activeProfile.local }));
  ipcMain.handle("xpaw:get-usage", (_event, filter?: { modelId?: string; days?: number }) => database.getUsageSummary(filter?.modelId, filter?.days));
  ipcMain.handle("xpaw:get-memory", () => ({ profile: database.getUserProfile(), memories: database.listMemories() }));
  ipcMain.handle("xpaw:save-user-profile", (_event, profile: UserProfile) => database.saveUserProfile(profile));
  ipcMain.handle("xpaw:add-memory", (_event, memory: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">) => database.addMemory(memory));
  ipcMain.handle("xpaw:update-memory", (_event, id: number, memory: Pick<MemoryItem, "category" | "content">) => database.updateMemory(id, memory));
  ipcMain.handle("xpaw:delete-memory", (_event, id: number) => database.deleteMemory(id));
  ipcMain.handle("xpaw:get-conversation-summary", (_event, id: number) => database.getConversationSummary(id));
  ipcMain.handle("xpaw:delete-conversation-summary", (_event, id: number) => database.deleteConversationSummary(id));
  ipcMain.handle("xpaw:list-knowledge", () => database.listKnowledgeDocuments());
  ipcMain.handle("xpaw:import-knowledge", (_event, filePath: string) => importKnowledgeFile(filePath));
  ipcMain.handle("xpaw:delete-knowledge", (_event, id: number) => database.deleteKnowledgeDocument(id));
  ipcMain.handle("xpaw:search-knowledge", (_event, query: string) => database.searchKnowledge(query));
  ipcMain.handle("xpaw:list-mcp-servers", () => database.listMcpServers());
  ipcMain.handle("xpaw:save-mcp-server", (_event, profile: Omit<McpServerProfile, "createdAt" | "updatedAt">) => database.upsertMcpServer(profile));
  ipcMain.handle("xpaw:delete-mcp-server", async (_event, id: string) => { await mcp.disconnect(id); database.deleteMcpServer(id); });
  ipcMain.handle("xpaw:list-mcp-tools", async (_event, id: string) => {
    const profile = database.listMcpServers().find((server) => server.id === id);
    if (!profile) throw new Error("MCP Server 不存在。");
    return mcp.listTools(profile, (toolName) => database.getMcpToolAuthorization(id, toolName));
  });
  ipcMain.handle("xpaw:set-mcp-tool-authorization", (_event, serverId: string, toolName: string, authorization: McpToolInfo["authorization"]) => database.setMcpToolAuthorization(serverId, toolName, authorization));
  ipcMain.handle("xpaw:test-mcp-tool", async (_event, serverId: string, toolName: string, args: Record<string, unknown>) => {
    const profile = database.listMcpServers().find((server) => server.id === serverId);
    if (!profile) throw new Error("MCP Server 不存在。");
    if (database.getMcpToolAuthorization(serverId, toolName) === "deny") throw new Error("该 MCP 工具已被拒绝。");
    return mcp.callTool(profile, toolName, args);
  });
  ipcMain.handle("xpaw:list-tasks", () => database.listTasks());
  ipcMain.handle("xpaw:get-task-events", (_event, taskId: number) => database.getTaskEvents(taskId));
  ipcMain.handle("xpaw:rerun-task", async (_event, taskId: number) => {
    const task = database.listTasks().find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在。");
    return { objective: task.objective };
  });
  ipcMain.handle("xpaw:list-models", () => listLocalModels());
  ipcMain.handle("xpaw:list-profiles", () => database.listModelProfiles());
  ipcMain.handle("xpaw:save-profile", async (_event, input: { profile: Omit<ModelProfile, "createdAt" | "updatedAt">; apiKey?: string }) => {
    const { profile } = input;
    if (!profile?.id || !profile.name || !profile.baseUrl || !profile.modelId) throw new Error("模型档案字段不完整。");
    database.upsertModelProfile(profile);
    if (profile.provider === "openai-compatible" && input.apiKey !== undefined) vault.set(profile.id, input.apiKey);
    if (profile.id === activeProfile.id) {
      activeProfile = database.listModelProfiles().find((item) => item.id === profile.id)!;
      agent = createAgent(character);
    }
    return database.listModelProfiles();
  });
  ipcMain.handle("xpaw:select-profile", async (_event, id: string) => {
    const selected = database.listModelProfiles().find((profile) => profile.id === id);
    if (!selected) throw new Error("模型档案不存在。");
    if (!selected.local && !vault.get(selected.id)) throw new Error("该云端模型档案尚未配置 API Key。");
    activeProfile = selected;
    modelId = selected.modelId;
    agent = createAgent(character);
    conversationId = database.createConversation(character.id, "Desktop session");
    return { profileId: activeProfile.id };
  });
  ipcMain.handle("xpaw:test-profile", async (_event, input: { baseUrl: string; modelId: string; provider: string; apiKey?: string }) => {
    const client = new OpenAiCompatibleClient(input.baseUrl, { modelId: input.modelId, temperature: 0, maxTokens: 8, toolsEnabled: false }, input.apiKey);
    await client.chat([{ role: "user", content: "Reply with OK." }], []);
    return { ok: true };
  });
  ipcMain.handle("xpaw:select-model", async (_event, requestedModelId: string) => {
    if (!requestedModelId || typeof requestedModelId !== "string") throw new Error("A model name is required.");
    const models = await listLocalModels();
    if (!models.includes(requestedModelId)) throw new Error("The selected model is not installed in Ollama.");
    modelId = requestedModelId;
    database.upsertModelProfile({ ...activeProfile, modelId, name: `本地 ${modelId}` });
    activeProfile = database.listModelProfiles().find((profile) => profile.id === activeProfile.id)!;
    agent = createAgent(character);
    conversationId = database.createConversation(character.id, "Desktop session");
    return { modelId: activeProfile.modelId };
  });
  ipcMain.handle("xpaw:get-character", () => ({ id: character.id, name: character.name, description: character.description, role: character.identity.role, summary: character.identity.summary, tone: character.personality.speaking_style.tone }));
  ipcMain.handle("xpaw:save-character", (_event, input: { name: string; description: string; role: string; summary: string; tone: string }) => {
    database.saveCharacterOverride({ characterId: character.id, ...input });
    character = { ...character, name: input.name, description: input.description, identity: { ...character.identity, role: input.role, summary: input.summary }, personality: { ...character.personality, speaking_style: { ...character.personality.speaking_style, tone: input.tone } } };
    agent = createAgent(character);
    return { id: character.id, ...input };
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => database?.close());
