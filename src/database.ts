import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatMessage } from "./types.js";

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
    `);
  }

  createConversation(characterId: string, title: string): number {
    const result = this.db.prepare("INSERT INTO conversations (character_id, title) VALUES (?, ?)").run(characterId, title);
    return Number(result.lastInsertRowid);
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

  getUsageSummary(): { totalTokens: number; todayTokens: number; requests: number; daily: Array<{ date: string; tokens: number }> } {
    const totals = this.db.prepare(`
      SELECT COALESCE(SUM(total_tokens), 0) AS totalTokens,
             COALESCE(SUM(CASE WHEN date(created_at, 'localtime') = date('now', 'localtime') THEN total_tokens ELSE 0 END), 0) AS todayTokens,
             COUNT(*) AS requests
      FROM model_runs WHERE status = 'completed'
    `).get() as { totalTokens: number; todayTokens: number; requests: number };
    const daily = this.db.prepare(`
      SELECT date(created_at, 'localtime') AS date, COALESCE(SUM(total_tokens), 0) AS tokens
      FROM model_runs WHERE status = 'completed' AND created_at >= datetime('now', '-364 days')
      GROUP BY date(created_at, 'localtime') ORDER BY date ASC
    `).all() as Array<{ date: string; tokens: number }>;
    return { ...totals, daily };
  }

  close(): void {
    this.db.close();
  }
}
