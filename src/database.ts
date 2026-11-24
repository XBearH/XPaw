import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatMessage, ModelProfile } from "./types.js";

export class XPawDatabase {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tool_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        authorization_state TEXT NOT NULL,
        status TEXT NOT NULL,
        result_summary TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS model_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model_id TEXT NOT NULL,
        temperature REAL NOT NULL,
        max_tokens INTEGER NOT NULL,
        tools_enabled INTEGER NOT NULL,
        local INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS character_overrides (
        character_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        role TEXT NOT NULL,
        summary TEXT NOT NULL,
        tone TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  createConversation(characterId: string, title: string): number {
    const result = this.db.prepare("INSERT INTO conversations (character_id, title) VALUES (?, ?)").run(characterId, title);
    return Number(result.lastInsertRowid);
  }

  listConversations(): Array<{ id: number; characterId: string; title: string; updatedAt: string }> {
    return this.db.prepare("SELECT id, character_id AS characterId, title, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC LIMIT 100").all() as Array<{ id: number; characterId: string; title: string; updatedAt: string }>;
  }

  renameConversation(id: number, title: string): void {
    this.db.prepare("UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(title, id);
  }

  deleteConversation(id: number): void {
    this.db.prepare("DELETE FROM tool_runs WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM model_runs WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  listModelProfiles(): ModelProfile[] {
    type ModelProfileRow = Omit<ModelProfile, "toolsEnabled" | "local"> & { toolsEnabled: number; local: number };
    const rows = this.db.prepare(`SELECT id, name, provider, base_url AS baseUrl, model_id AS modelId, temperature, max_tokens AS maxTokens, tools_enabled AS toolsEnabled, local, created_at AS createdAt, updated_at AS updatedAt FROM model_profiles ORDER BY updated_at DESC`).all() as ModelProfileRow[];
    return rows.map((row) => ({ ...row, toolsEnabled: Boolean(row.toolsEnabled), local: Boolean(row.local) }));
  }

  upsertModelProfile(profile: Omit<ModelProfile, "createdAt" | "updatedAt">): void {
    this.db.prepare(`
      INSERT INTO model_profiles (id, name, provider, base_url, model_id, temperature, max_tokens, tools_enabled, local)
      VALUES (@id, @name, @provider, @baseUrl, @modelId, @temperature, @maxTokens, @toolsEnabled, @local)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider = excluded.provider, base_url = excluded.base_url,
        model_id = excluded.model_id, temperature = excluded.temperature, max_tokens = excluded.max_tokens,
        tools_enabled = excluded.tools_enabled, local = excluded.local, updated_at = CURRENT_TIMESTAMP
    `).run({ ...profile, toolsEnabled: Number(profile.toolsEnabled), local: Number(profile.local) });
  }

  deleteModelProfile(id: string): void {
    this.db.prepare("DELETE FROM model_profiles WHERE id = ?").run(id);
  }

  getCharacterOverride(characterId: string): { name: string; description: string; role: string; summary: string; tone: string } | undefined {
    return this.db.prepare("SELECT name, description, role, summary, tone FROM character_overrides WHERE character_id = ?").get(characterId) as { name: string; description: string; role: string; summary: string; tone: string } | undefined;
  }

  saveCharacterOverride(input: { characterId: string; name: string; description: string; role: string; summary: string; tone: string }): void {
    this.db.prepare(`INSERT INTO character_overrides (character_id, name, description, role, summary, tone)
      VALUES (@characterId, @name, @description, @role, @summary, @tone)
      ON CONFLICT(character_id) DO UPDATE SET name = excluded.name, description = excluded.description, role = excluded.role, summary = excluded.summary, tone = excluded.tone, updated_at = CURRENT_TIMESTAMP`).run(input);
  }

  saveMessage(conversationId: number, message: ChatMessage): void {
    this.db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)").run(conversationId, message.role, message.content);
    this.db.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(conversationId);
  }

  getMessages(conversationId: number, limit = 30): ChatMessage[] {
    return this.db.prepare(`
      SELECT role, content FROM (
        SELECT role, content, id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
      ) ORDER BY id ASC
    `).all(conversationId, limit) as ChatMessage[];
  }

  auditToolRun(input: {
    conversationId: number;
    toolName: string;
    argumentsJson: string;
    authorizationState: "approved" | "denied" | "not_required";
    status: "completed" | "failed" | "cancelled";
    resultSummary?: string;
    error?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO tool_runs (conversation_id, tool_name, arguments_json, authorization_state, status, result_summary, error)
      VALUES (@conversationId, @toolName, @argumentsJson, @authorizationState, @status, @resultSummary, @error)
    `).run({
      ...input,
      resultSummary: input.resultSummary ?? null,
      error: input.error ?? null,
    });
  }

  recordModelRun(input: {
    conversationId: number;
    provider: string;
    modelId: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    durationMs: number;
    status: "completed" | "failed" | "cancelled";
  }): void {
    this.db.prepare(`
      INSERT INTO model_runs (conversation_id, provider, model_id, prompt_tokens, completion_tokens, total_tokens, duration_ms, status)
      VALUES (@conversationId, @provider, @modelId, @promptTokens, @completionTokens, @totalTokens, @durationMs, @status)
    `).run({
      ...input,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
    });
  }

  getUsageSummary(modelId?: string, days = 365): { totalTokens: number; todayTokens: number; requests: number; daily: Array<{ date: string; tokens: number }> } {
    const where = modelId ? "WHERE status = 'completed' AND model_id = @modelId" : "WHERE status = 'completed'";
    const totals = this.db.prepare(`
      SELECT COALESCE(SUM(total_tokens), 0) AS totalTokens,
             COALESCE(SUM(CASE WHEN date(created_at, 'localtime') = date('now', 'localtime') THEN total_tokens ELSE 0 END), 0) AS todayTokens,
             COUNT(*) AS requests
      FROM model_runs ${where}
    `).get(modelId ? { modelId } : {}) as { totalTokens: number; todayTokens: number; requests: number };
    const daily = this.db.prepare(`
      SELECT date(created_at, 'localtime') AS date, COALESCE(SUM(total_tokens), 0) AS tokens
      FROM model_runs ${where} ${modelId ? "AND" : "AND"} created_at >= datetime('now', @since)
      GROUP BY date(created_at, 'localtime') ORDER BY date ASC
    `).all(modelId ? { modelId, since: `-${Math.max(1, Math.min(days, 3650)) - 1} days` } : { since: `-${Math.max(1, Math.min(days, 3650)) - 1} days` }) as Array<{ date: string; tokens: number }>;
    return { ...totals, daily };
  }

  close(): void {
    this.db.close();
  }
}
