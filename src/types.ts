export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ModelResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: ModelUsage;
}

export interface ModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ModelClient {
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelResponse>;
  streamChat(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): AsyncGenerator<ModelStreamEvent>;
}

export type ModelStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "completed"; response: ModelResponse };

export type AgentStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_started"; name: string }
  | { type: "tool_finished"; name: string; summary: string }
  | { type: "completed"; content: string; usage?: ModelUsage }
  | { type: "cancelled" }
  | { type: "failed"; message: string };

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolResult {
  content: string;
  summary: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: "ollama" | "openai-compatible";
  baseUrl: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  toolsEnabled: boolean;
  local: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelCapabilities {
  thinking: boolean;
  tools: boolean;
  roleplay: "experimental" | "suitable" | "recommended";
  contextWindow: number;
}

export type TaskStatus = "queued" | "planning" | "awaiting_confirmation" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface TaskSummary {
  id: number;
  conversationId: number;
  objective: string;
  status: TaskStatus;
  plan: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: number;
  taskId: number;
  type: string;
  message: string;
  data: string | null;
  createdAt: string;
}

export interface MemoryItem {
  id: number;
  category: "preference" | "fact" | "instruction" | "summary";
  content: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  preferredName: string;
  language: string;
  timezone: string;
  communicationStyle: string;
}

export interface KnowledgeDocument {
  id: number;
  path: string;
  name: string;
  contentHash: string;
  chunkCount: number;
  importedAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: number;
  documentId: number;
  path: string;
  name: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface McpServerProfile {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolInfo {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  authorization: "ask" | "always" | "deny";
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  main: string;
  permissions: string[];
}

export interface PluginProfile {
  id: string;
  name: string;
  version: string;
  path: string;
  permissions: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PluginToolInfo {
  pluginId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  authorization: "ask" | "always" | "deny";
}

export type InteractionMode = "conversation" | "roleplay" | "task";

export interface CompanionState {
  relationshipLabel: string;
  boundaries: string;
  sceneTitle: string;
  sceneSetting: string;
  sceneSummary: string;
  updatedAt: string;
}

export interface SceneCheckpoint {
  id: number;
  title: string;
  summary: string;
  createdAt: string;
}
