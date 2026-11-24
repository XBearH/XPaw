import type { ChatMessage, ModelResponse, ToolCall, ToolDefinition } from "./types.js";

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
  error?: { message?: string };
}

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelResponse> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
          ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
        })),
        tools,
        tool_choice: "auto",
        max_tokens: 512,
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json() as OpenAiResponse;
    if (!response.ok) throw new Error(data.error?.message || `Model request failed with status ${response.status}.`);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Model response did not include a message.");
    return { content: message.content ?? null, toolCalls: message.tool_calls ?? [] };
  }
}
