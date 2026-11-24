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
