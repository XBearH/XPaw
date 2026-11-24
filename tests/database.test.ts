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
});
