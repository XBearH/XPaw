import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatMessage, CompanionState, KnowledgeChunk, KnowledgeDocument, McpServerProfile, McpToolInfo, MemoryItem, ModelProfile, PluginProfile, PluginToolInfo, SceneCheckpoint, TaskEvent, TaskStatus, TaskSummary, UserProfile } from "./types.js";

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
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        plan TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, content='memories', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        preferred_name TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'zh-CN',
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        communication_style TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id),
        content TEXT NOT NULL,
        source_message_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(content, content='knowledge_chunks', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT,
        args_json TEXT NOT NULL DEFAULT '[]',
        url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS mcp_tool_permissions (
        server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        authorization TEXT NOT NULL DEFAULT 'ask',
        PRIMARY KEY (server_id, tool_name)
      );
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        permissions_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS plugin_tool_permissions (
        plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        authorization TEXT NOT NULL DEFAULT 'ask',
        PRIMARY KEY (plugin_id, tool_name)
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS companion_state (
        character_id TEXT PRIMARY KEY,
        relationship_label TEXT NOT NULL DEFAULT '朋友',
        boundaries TEXT NOT NULL DEFAULT '',
        scene_title TEXT NOT NULL DEFAULT '',
        scene_setting TEXT NOT NULL DEFAULT '',
        scene_summary TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS scene_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  markRunningTasksInterrupted(): void {
    this.db.prepare("UPDATE tasks SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP WHERE status IN ('queued', 'planning', 'awaiting_confirmation', 'running')").run();
  }

  createTask(conversationId: number, objective: string): number {
    const result = this.db.prepare("INSERT INTO tasks (conversation_id, objective, status) VALUES (?, ?, 'queued')").run(conversationId, objective);
    return Number(result.lastInsertRowid);
  }

  updateTask(id: number, status: TaskStatus, options: { plan?: string | null; error?: string | null } = {}): void {
    this.db.prepare("UPDATE tasks SET status = @status, plan = COALESCE(@plan, plan), error = @error, updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id, status, plan: options.plan ?? null, error: options.error ?? null });
  }

  addTaskEvent(taskId: number, type: string, message: string, data?: unknown): void {
    this.db.prepare("INSERT INTO task_events (task_id, type, message, data) VALUES (?, ?, ?, ?)").run(taskId, type, message, data === undefined ? null : JSON.stringify(data));
  }

  listTasks(): TaskSummary[] {
    return this.db.prepare("SELECT id, conversation_id AS conversationId, objective, status, plan, error, created_at AS createdAt, updated_at AS updatedAt FROM tasks ORDER BY updated_at DESC LIMIT 100").all() as TaskSummary[];
  }

  getTaskEvents(taskId: number): TaskEvent[] {
    return this.db.prepare("SELECT id, task_id AS taskId, type, message, data, created_at AS createdAt FROM task_events WHERE task_id = ? ORDER BY id ASC").all(taskId) as TaskEvent[];
  }

  getUserProfile(): UserProfile {
    const row = this.db.prepare("SELECT preferred_name AS preferredName, language, timezone, communication_style AS communicationStyle FROM user_profile WHERE id = 1").get() as UserProfile | undefined;
    return row ?? { preferredName: "", language: "zh-CN", timezone: "Asia/Shanghai", communicationStyle: "" };
  }

  saveUserProfile(profile: UserProfile): void {
    this.db.prepare(`INSERT INTO user_profile (id, preferred_name, language, timezone, communication_style) VALUES (1, @preferredName, @language, @timezone, @communicationStyle)
      ON CONFLICT(id) DO UPDATE SET preferred_name = excluded.preferred_name, language = excluded.language, timezone = excluded.timezone, communication_style = excluded.communication_style, updated_at = CURRENT_TIMESTAMP`).run(profile);
  }

  listMemories(): MemoryItem[] {
    return this.db.prepare("SELECT id, category, content, source, created_at AS createdAt, updated_at AS updatedAt FROM memories ORDER BY updated_at DESC").all() as MemoryItem[];
  }

  addMemory(input: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">): number {
    const result = this.db.prepare("INSERT INTO memories (category, content, source) VALUES (?, ?, ?)").run(input.category, input.content, input.source);
    return Number(result.lastInsertRowid);
  }

  updateMemory(id: number, input: Pick<MemoryItem, "category" | "content">): void {
    this.db.prepare("UPDATE memories SET category = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(input.category, input.content, id);
  }

  deleteMemory(id: number): void {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  searchMemories(query: string, limit = 5): MemoryItem[] {
    if (/\p{Script=Han}/u.test(query)) {
      return this.db.prepare("SELECT id, category, content, source, created_at AS createdAt, updated_at AS updatedAt FROM memories WHERE content LIKE ? ORDER BY updated_at DESC LIMIT ?").all(`%${query.trim()}%`, limit) as MemoryItem[];
    }
    const tokens = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 8) ?? [];
    if (tokens.length === 0) return [];
    const expression = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
    return this.db.prepare(`SELECT m.id, m.category, m.content, m.source, m.created_at AS createdAt, m.updated_at AS updatedAt FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?`).all(expression, limit) as MemoryItem[];
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

  deleteLatestAssistantMessage(conversationId: number): void {
    this.db.prepare("DELETE FROM messages WHERE id = (SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1)").run(conversationId);
  }

  getLatestUserMessage(conversationId: number): string | undefined {
    const row = this.db.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1").get(conversationId) as { content: string } | undefined;
    return row?.content;
  }

  getConversationSummary(conversationId: number): { content: string; sourceMessageCount: number; updatedAt: string } | undefined {
    return this.db.prepare("SELECT content, source_message_count AS sourceMessageCount, updated_at AS updatedAt FROM conversation_summaries WHERE conversation_id = ?").get(conversationId) as { content: string; sourceMessageCount: number; updatedAt: string } | undefined;
  }

  saveConversationSummary(conversationId: number, content: string, sourceMessageCount: number): void {
    this.db.prepare(`INSERT INTO conversation_summaries (conversation_id, content, source_message_count) VALUES (?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET content = excluded.content, source_message_count = excluded.source_message_count, updated_at = CURRENT_TIMESTAMP`).run(conversationId, content, sourceMessageCount);
  }

  deleteConversationSummary(conversationId: number): void {
    this.db.prepare("DELETE FROM conversation_summaries WHERE conversation_id = ?").run(conversationId);
  }

  listKnowledgeDocuments(): KnowledgeDocument[] {
    return this.db.prepare("SELECT id, path, name, content_hash AS contentHash, chunk_count AS chunkCount, imported_at AS importedAt, updated_at AS updatedAt FROM knowledge_documents ORDER BY updated_at DESC").all() as KnowledgeDocument[];
  }

  upsertKnowledgeDocument(input: { path: string; name: string; contentHash: string; chunks: Array<{ startLine: number; endLine: number; content: string }> }): void {
    const transaction = this.db.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM knowledge_documents WHERE path = ?").get(input.path) as { id: number } | undefined;
      if (existing) {
        this.db.prepare("DELETE FROM knowledge_chunks WHERE document_id = ?").run(existing.id);
        this.db.prepare("UPDATE knowledge_documents SET name = ?, content_hash = ?, chunk_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(input.name, input.contentHash, input.chunks.length, existing.id);
        for (const chunk of input.chunks) this.db.prepare("INSERT INTO knowledge_chunks (document_id, start_line, end_line, content) VALUES (?, ?, ?, ?)").run(existing.id, chunk.startLine, chunk.endLine, chunk.content);
        return;
      }
      const result = this.db.prepare("INSERT INTO knowledge_documents (path, name, content_hash, chunk_count) VALUES (?, ?, ?, ?)").run(input.path, input.name, input.contentHash, input.chunks.length);
      const documentId = Number(result.lastInsertRowid);
      for (const chunk of input.chunks) this.db.prepare("INSERT INTO knowledge_chunks (document_id, start_line, end_line, content) VALUES (?, ?, ?, ?)").run(documentId, chunk.startLine, chunk.endLine, chunk.content);
    });
    transaction();
  }

  deleteKnowledgeDocument(id: number): void {
    this.db.prepare("DELETE FROM knowledge_chunks WHERE document_id = ?").run(id);
    this.db.prepare("DELETE FROM knowledge_documents WHERE id = ?").run(id);
  }

  searchKnowledge(query: string, limit = 6): KnowledgeChunk[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (/\p{Script=Han}/u.test(trimmed)) {
      return this.db.prepare(`SELECT c.id, c.document_id AS documentId, d.path, d.name, c.start_line AS startLine, c.end_line AS endLine, c.content FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE c.content LIKE ? ORDER BY d.updated_at DESC LIMIT ?`).all(`%${trimmed}%`, limit) as KnowledgeChunk[];
    }
    const tokens = trimmed.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 8) ?? [];
    if (tokens.length === 0) return [];
    const expression = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
    return this.db.prepare(`SELECT c.id, c.document_id AS documentId, d.path, d.name, c.start_line AS startLine, c.end_line AS endLine, c.content FROM knowledge_chunks_fts f JOIN knowledge_chunks c ON c.id = f.rowid JOIN knowledge_documents d ON d.id = c.document_id WHERE knowledge_chunks_fts MATCH ? ORDER BY bm25(knowledge_chunks_fts) LIMIT ?`).all(expression, limit) as KnowledgeChunk[];
  }

  listMcpServers(): McpServerProfile[] {
    const rows = this.db.prepare("SELECT id, name, transport, command, args_json AS argsJson, url, enabled, created_at AS createdAt, updated_at AS updatedAt FROM mcp_servers ORDER BY updated_at DESC").all() as Array<{ id: string; name: string; transport: "stdio" | "http"; command: string | null; argsJson: string; url: string | null; enabled: number; createdAt: string; updatedAt: string }>;
    return rows.map((row) => ({ id: row.id, name: row.name, transport: row.transport, command: row.command, args: JSON.parse(row.argsJson) as string[], url: row.url, enabled: Boolean(row.enabled), createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }

  upsertMcpServer(profile: Omit<McpServerProfile, "createdAt" | "updatedAt">): void {
    this.db.prepare(`INSERT INTO mcp_servers (id, name, transport, command, args_json, url, enabled) VALUES (@id, @name, @transport, @command, @argsJson, @url, @enabled)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, transport = excluded.transport, command = excluded.command, args_json = excluded.args_json, url = excluded.url, enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`).run({ ...profile, argsJson: JSON.stringify(profile.args), enabled: Number(profile.enabled) });
  }

  deleteMcpServer(id: string): void {
    this.db.prepare("DELETE FROM mcp_tool_permissions WHERE server_id = ?").run(id);
    this.db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  }

  getMcpToolAuthorization(serverId: string, toolName: string): McpToolInfo["authorization"] {
    const row = this.db.prepare("SELECT authorization FROM mcp_tool_permissions WHERE server_id = ? AND tool_name = ?").get(serverId, toolName) as { authorization: McpToolInfo["authorization"] } | undefined;
    return row?.authorization ?? "ask";
  }

  setMcpToolAuthorization(serverId: string, toolName: string, authorization: McpToolInfo["authorization"]): void {
    this.db.prepare(`INSERT INTO mcp_tool_permissions (server_id, tool_name, authorization) VALUES (?, ?, ?)
      ON CONFLICT(server_id, tool_name) DO UPDATE SET authorization = excluded.authorization`).run(serverId, toolName, authorization);
  }

  listPlugins(): PluginProfile[] {
    const rows = this.db.prepare("SELECT id, name, version, path, permissions_json AS permissionsJson, enabled, created_at AS createdAt, updated_at AS updatedAt FROM plugins ORDER BY updated_at DESC").all() as Array<{ id: string; name: string; version: string; path: string; permissionsJson: string; enabled: number; createdAt: string; updatedAt: string }>;
    return rows.map((row) => ({ id: row.id, name: row.name, version: row.version, path: row.path, permissions: JSON.parse(row.permissionsJson) as string[], enabled: Boolean(row.enabled), createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }

  upsertPlugin(profile: Omit<PluginProfile, "createdAt" | "updatedAt">): void {
    this.db.prepare(`INSERT INTO plugins (id, name, version, path, permissions_json, enabled) VALUES (@id, @name, @version, @path, @permissionsJson, @enabled)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, path = excluded.path, permissions_json = excluded.permissions_json, enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`).run({ ...profile, permissionsJson: JSON.stringify(profile.permissions), enabled: Number(profile.enabled) });
  }

  deletePlugin(id: string): void {
    this.db.prepare("DELETE FROM plugin_tool_permissions WHERE plugin_id = ?").run(id);
    this.db.prepare("DELETE FROM plugins WHERE id = ?").run(id);
  }

  getPluginToolAuthorization(pluginId: string, toolName: string): PluginToolInfo["authorization"] {
    const row = this.db.prepare("SELECT authorization FROM plugin_tool_permissions WHERE plugin_id = ? AND tool_name = ?").get(pluginId, toolName) as { authorization: PluginToolInfo["authorization"] } | undefined;
    return row?.authorization ?? "ask";
  }

  setPluginToolAuthorization(pluginId: string, toolName: string, authorization: PluginToolInfo["authorization"]): void {
    this.db.prepare(`INSERT INTO plugin_tool_permissions (plugin_id, tool_name, authorization) VALUES (?, ?, ?)
      ON CONFLICT(plugin_id, tool_name) DO UPDATE SET authorization = excluded.authorization`).run(pluginId, toolName, authorization);
  }

  getSetting(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  getCompanionState(characterId: string): CompanionState {
    const row = this.db.prepare("SELECT relationship_label AS relationshipLabel, boundaries, scene_title AS sceneTitle, scene_setting AS sceneSetting, scene_summary AS sceneSummary, updated_at AS updatedAt FROM companion_state WHERE character_id = ?").get(characterId) as CompanionState | undefined;
    return row ?? { relationshipLabel: "朋友", boundaries: "", sceneTitle: "", sceneSetting: "", sceneSummary: "", updatedAt: "" };
  }

  saveCompanionState(characterId: string, state: Omit<CompanionState, "updatedAt">): void {
    this.db.prepare(`INSERT INTO companion_state (character_id, relationship_label, boundaries, scene_title, scene_setting, scene_summary) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET relationship_label = excluded.relationship_label, boundaries = excluded.boundaries, scene_title = excluded.scene_title, scene_setting = excluded.scene_setting, scene_summary = excluded.scene_summary, updated_at = CURRENT_TIMESTAMP`).run(characterId, state.relationshipLabel, state.boundaries, state.sceneTitle, state.sceneSetting, state.sceneSummary);
  }

  listSceneCheckpoints(characterId: string): SceneCheckpoint[] {
    return this.db.prepare("SELECT id, title, summary, created_at AS createdAt FROM scene_checkpoints WHERE character_id = ? ORDER BY id DESC").all(characterId) as SceneCheckpoint[];
  }

  addSceneCheckpoint(characterId: string, title: string, summary: string): number {
    return Number(this.db.prepare("INSERT INTO scene_checkpoints (character_id, title, summary) VALUES (?, ?, ?)").run(characterId, title, summary).lastInsertRowid);
  }

  deleteSceneCheckpoint(id: number): void {
    this.db.prepare("DELETE FROM scene_checkpoints WHERE id = ?").run(id);
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
