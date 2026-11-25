import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XPawDatabase } from "../src/database.js";

describe("XPawDatabase", () => {
  let directory: string;
  let database: XPawDatabase;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "xpaw-db-"));
    database = new XPawDatabase(join(directory, "xpaw.sqlite"));
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("records tool runs when optional result fields are absent", () => {
    const conversationId = database.createConversation("test-agent", "Test");
    expect(() => database.auditToolRun({
      conversationId,
      toolName: "write_file",
      argumentsJson: "{}",
      authorizationState: "denied",
      status: "cancelled",
    })).not.toThrow();
  });

  it("persists model profiles and conversation lifecycle", () => {
    database.upsertModelProfile({
      id: "local", name: "Local", provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1",
      modelId: "qwen2.5:3b", temperature: 0.35, maxTokens: 384, toolsEnabled: true, local: true,
    });
    expect(database.listModelProfiles()).toMatchObject([{ id: "local", toolsEnabled: true, local: true }]);
    const conversationId = database.createConversation("test-agent", "Original");
    database.renameConversation(conversationId, "Renamed");
    expect(database.listConversations()[0]).toMatchObject({ id: conversationId, title: "Renamed" });
    database.deleteConversation(conversationId);
    expect(database.listConversations()).toHaveLength(0);
  });

  it("persists a local character override", () => {
    database.saveCharacterOverride({ characterId: "test-agent", name: "New Name", description: "Description", role: "Assistant", summary: "Summary", tone: "Clear" });
    expect(database.getCharacterOverride("test-agent")).toMatchObject({ name: "New Name", tone: "Clear" });
  });

  it("marks unfinished tasks as interrupted after a restart", () => {
    const conversationId = database.createConversation("test-agent", "Task");
    const taskId = database.createTask(conversationId, "Read a file");
    database.updateTask(taskId, "running", { plan: "Read the requested file." });
    database.addTaskEvent(taskId, "running", "Task started.");
    database.markRunningTasksInterrupted();
    expect(database.listTasks()[0]).toMatchObject({ id: taskId, status: "interrupted", plan: "Read the requested file." });
    expect(database.getTaskEvents(taskId)).toHaveLength(1);
  });

  it("removes only the latest assistant answer for regeneration", () => {
    const conversationId = database.createConversation("test-agent", "Regenerate");
    database.saveMessage(conversationId, { role: "user", content: "Hello" });
    database.saveMessage(conversationId, { role: "assistant", content: "First answer" });
    database.deleteLatestAssistantMessage(conversationId);
    expect(database.getLatestUserMessage(conversationId)).toBe("Hello");
    expect(database.getMessages(conversationId)).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("stores searchable user-approved memories and summaries", () => {
    database.saveUserProfile({ preferredName: "小熊", language: "zh-CN", timezone: "Asia/Shanghai", communicationStyle: "简洁" });
    expect(database.getUserProfile()).toMatchObject({ preferredName: "小熊", communicationStyle: "简洁" });
    const memoryId = database.addMemory({ category: "preference", content: "用户偏好中文回答", source: "user" });
    expect(database.searchMemories("中文回答")).toMatchObject([{ id: memoryId }]);
    const conversationId = database.createConversation("test-agent", "Summary");
    database.saveConversationSummary(conversationId, "用户偏好中文。", 20);
    expect(database.getConversationSummary(conversationId)).toMatchObject({ content: "用户偏好中文。", sourceMessageCount: 20 });
    database.deleteMemory(memoryId);
    expect(database.searchMemories("中文回答")).toHaveLength(0);
  });

  it("indexes and searches local knowledge chunks", () => {
    database.upsertKnowledgeDocument({ path: "D:/notes/project.md", name: "project.md", contentHash: "hash", chunks: [{ startLine: 1, endLine: 2, content: "XPaw uses SQLite for local state." }] });
    expect(database.searchKnowledge("SQLite")).toMatchObject([{ name: "project.md", startLine: 1 }]);
    const document = database.listKnowledgeDocuments()[0];
    database.deleteKnowledgeDocument(document.id);
    expect(database.listKnowledgeDocuments()).toHaveLength(0);
  });

  it("persists MCP server profiles and per-tool authorization", () => {
    database.upsertMcpServer({ id: "mcp-test", name: "Test MCP", transport: "stdio", command: "node", args: ["server.js"], url: null, enabled: true });
    expect(database.listMcpServers()).toMatchObject([{ id: "mcp-test", args: ["server.js"], enabled: true }]);
    expect(database.getMcpToolAuthorization("mcp-test", "echo")).toBe("ask");
    database.setMcpToolAuthorization("mcp-test", "echo", "always");
    expect(database.getMcpToolAuthorization("mcp-test", "echo")).toBe("always");
    database.deleteMcpServer("mcp-test");
    expect(database.listMcpServers()).toHaveLength(0);
  });

  it("persists companion state and scene checkpoints separately from user memories", () => {
    database.saveCompanionState("test-agent", { relationshipLabel: "搭档", boundaries: "保持轻松", sceneTitle: "雨夜咖啡馆", sceneSetting: "靠窗座位", sceneSummary: "正在聊天" });
    expect(database.getCompanionState("test-agent")).toMatchObject({ relationshipLabel: "搭档", sceneTitle: "雨夜咖啡馆" });
    const checkpointId = database.addSceneCheckpoint("test-agent", "第一幕", "雨夜的咖啡馆对话。");
    expect(database.listSceneCheckpoints("test-agent")).toMatchObject([{ id: checkpointId, title: "第一幕" }]);
    database.deleteSceneCheckpoint(checkpointId);
    expect(database.listSceneCheckpoints("test-agent")).toHaveLength(0);
  });

  it("persists model capabilities and mode defaults", () => {
    database.upsertModelProfile({ id: "profile", name: "Profile", provider: "ollama", baseUrl: "http://127.0.0.1:11434/v1", modelId: "qwen2.5:3b", temperature: 0.3, maxTokens: 384, toolsEnabled: true, local: true });
    database.saveModelCapabilities("profile", { thinking: false, tools: true, roleplay: "suitable", contextWindow: 32768 });
    database.setModeProfileId("roleplay", "profile");
    expect(database.getModelCapabilities("profile")).toMatchObject({ roleplay: "suitable", contextWindow: 32768 });
    expect(database.getModeProfileId("roleplay")).toBe("profile");
  });
});
